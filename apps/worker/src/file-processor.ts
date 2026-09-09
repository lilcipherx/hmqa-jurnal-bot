import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '@hmqa/config';
import { journalRequirementConfigSchema } from '@hmqa/contracts';
import type { DatabaseClient, Prisma } from '@hmqa/database';
import { attachmentContentDisposition } from '@hmqa/security';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';
import { findAnonymizedIdentifierTypes } from './anonymization-preflight.js';
import { scanFile } from './clamav.js';
import { parseDocxModel, runDocxPreflight, type DocxPreflightResult } from './docx-preflight.js';
import { readDocxXmlPart } from './docx-validator.js';
import { inspectUpload } from './file-validator.js';

const telegramFileResponse = z.object({
  ok: z.literal(true),
  result: z.object({ file_path: z.string(), file_size: z.number().int().optional() }),
});

async function downloadTelegramFile(
  config: AppConfig,
  providerFileId: string,
  destination: string,
): Promise<{ sha256: string; sizeBytes: number }> {
  const metadataResponse = await fetch(
    `${config.BOT_API_BASE_URL}/bot${config.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(providerFileId)}`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!metadataResponse.ok) throw new Error(`TELEGRAM_GET_FILE_${metadataResponse.status}`);
  const metadata = telegramFileResponse.parse(await metadataResponse.json());
  if ((metadata.result.file_size ?? 0) > config.FILE_MAX_BYTES)
    throw new UnrecoverableError('FILE_TOO_LARGE');
  const response = await fetch(
    `${config.BOT_API_BASE_URL}/file/bot${config.TELEGRAM_BOT_TOKEN}/${metadata.result.file_path}`,
    { signal: AbortSignal.timeout(60_000) },
  );
  if (!response.ok || !response.body) throw new Error(`TELEGRAM_DOWNLOAD_${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > config.FILE_MAX_BYTES) throw new UnrecoverableError('FILE_TOO_LARGE');
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const source = Readable.fromWeb(response.body as never);
  source.on('data', (chunk: Buffer) => {
    sizeBytes += chunk.length;
    if (sizeBytes > config.FILE_MAX_BYTES) source.destroy(new UnrecoverableError('FILE_TOO_LARGE'));
    hash.update(chunk);
  });
  await pipeline(source, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return { sha256: hash.digest('hex'), sizeBytes };
}

function provenance(value: Prisma.JsonValue): { providerFileId?: string } {
  if (typeof value !== 'object' || !value || Array.isArray(value))
    throw new UnrecoverableError('FILE_PROVENANCE_INVALID');
  if (value.provider === 'admin-derived-upload') return {};
  if (typeof value.providerFileId !== 'string')
    throw new UnrecoverableError('FILE_PROVENANCE_INVALID');
  return { providerFileId: value.providerFileId };
}

function assertDeclaredMime(declaredMime: string | null, format: 'docx' | 'pdf'): void {
  if (!declaredMime) return;
  const expected =
    format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (declaredMime.toLowerCase() !== expected)
    throw new UnrecoverableError('DECLARED_MIME_MISMATCH');
}

export function createFileProcessor(config: AppConfig, database: DatabaseClient, s3: S3Client) {
  return async (job: Job<{ fileAssetId: string }>) => {
    const asset = await database.fileAsset.findUnique({
      where: { id: job.data.fileAssetId },
      include: {
        draftLinks: {
          where: { replacedAt: null },
          include: { draft: { include: { requirementVersion: true } } },
        },
        submissionLinks: {
          where: { category: 'ANONYMIZED_MANUSCRIPT' },
          include: {
            submissionVersion: { include: { authors: { select: { dataSnapshot: true } } } },
          },
        },
      },
    });
    if (!asset) throw new UnrecoverableError('FILE_ASSET_NOT_FOUND');
    const executePreflights = async (path: string, format: 'docx' | 'pdf') => {
      for (const link of asset.draftLinks) {
        const configResult = journalRequirementConfigSchema.safeParse(
          link.draft.requirementVersion?.config,
        );
        const policy = configResult.success
          ? configResult.data.requiredFiles.find((item) => item.category === link.category)
          : undefined;
        if (!configResult.success || !policy) {
          await database.draftPreflightRun.updateMany({
            where: { draftId: link.draftId, fileId: asset.id },
            data: {
              status: 'FAILED',
              ruleSetVersion: 'invalid-requirement-config',
              toolVersion: 'hmqa-docx-preflight-1',
              blockingCount: 1,
              errorCount: 0,
              warningCount: 0,
              findings: [{ code: 'REQUIREMENT_CONFIG_INVALID', severity: 'BLOCKING' }],
              finishedAt: new Date(),
            },
          });
          continue;
        }
        let result: DocxPreflightResult = {
          findings: [],
          blockingCount: 0,
          errorCount: 0,
          warningCount: 0,
          statistics: { paragraphCount: 0, sectionCount: 0, renderedPageCount: null },
        };
        let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
        if (policy.preflightRequired && format === 'docx') {
          try {
            result = await runDocxPreflight(path, configResult.data.preflight!.docx!, {
              executable: config.LIBREOFFICE_PATH,
              timeoutMs: config.PREFLIGHT_RENDER_TIMEOUT_MS,
            });
          } catch {
            status = 'FAILED';
            result = {
              findings: [{ code: 'DOCX_PREFLIGHT_FAILED', severity: 'BLOCKING' }],
              blockingCount: 1,
              errorCount: 0,
              warningCount: 0,
              statistics: { paragraphCount: 0, sectionCount: 0, renderedPageCount: null },
            };
          }
        }
        await database.draftPreflightRun.updateMany({
          where: { draftId: link.draftId, fileId: asset.id },
          data: {
            status,
            ruleSetVersion:
              format === 'docx'
                ? (configResult.data.preflight?.docx?.rulesVersion ?? 'docx-security-v1')
                : 'pdf-security-v1',
            toolVersion: 'hmqa-docx-preflight-1',
            blockingCount: result.blockingCount,
            errorCount: result.errorCount,
            warningCount: result.warningCount,
            findings: JSON.parse(
              JSON.stringify([
                ...result.findings,
                { code: 'PREFLIGHT_STATISTICS', severity: 'INFO', actual: result.statistics },
              ]),
            ) as Prisma.InputJsonValue,
            finishedAt: new Date(),
          },
        });
      }
    };
    const executeAnonymizationPreflights = async (path: string, format: 'docx' | 'pdf') => {
      for (const link of asset.submissionLinks) {
        try {
          let findings: Prisma.InputJsonValue;
          let errorCount = 0;
          let warningCount = 0;
          if (format === 'docx') {
            const [documentXml, stylesXml, coreXml, customXml] = await Promise.all([
              readDocxXmlPart(path, 'word/document.xml'),
              readDocxXmlPart(path, 'word/styles.xml'),
              readDocxXmlPart(path, 'docProps/core.xml'),
              readDocxXmlPart(path, 'docProps/custom.xml'),
            ]);
            if (!documentXml) throw new Error('DOCX_DOCUMENT_XML_MISSING');
            const model = parseDocxModel(documentXml, stylesXml);
            const identifierTypes = findAnonymizedIdentifierTypes(
              `${model.plainText}\n${coreXml ?? ''}\n${customXml ?? ''}`,
              link.submissionVersion.authors.map((author) => author.dataSnapshot),
            );
            errorCount = identifierTypes.length > 0 ? 1 : 0;
            findings = [
              identifierTypes.length > 0
                ? {
                    code: 'ANONYMIZATION_IDENTIFIER_MATCH',
                    severity: 'ERROR',
                    actual: { identifierTypes, matchTypeCount: identifierTypes.length },
                  }
                : { code: 'ANONYMIZATION_IDENTIFIER_SCAN_CLEAR', severity: 'INFO' },
              { code: 'ANONYMIZATION_MANUAL_VERIFICATION_REQUIRED', severity: 'WARNING' },
            ];
            warningCount = 1;
          } else {
            findings = [
              { code: 'ANONYMIZATION_MANUAL_VERIFICATION_REQUIRED', severity: 'WARNING' },
            ];
            warningCount = 1;
          }
          await database.preflightRun.updateMany({
            where: {
              submissionVersionId: link.submissionVersionId,
              fileId: asset.id,
              ruleSetVersion: 'anonymization-pf015-v1',
            },
            data: {
              status: 'COMPLETED',
              blockingCount: 0,
              errorCount,
              warningCount,
              findings,
              finishedAt: new Date(),
            },
          });
        } catch {
          await database.preflightRun.updateMany({
            where: {
              submissionVersionId: link.submissionVersionId,
              fileId: asset.id,
              ruleSetVersion: 'anonymization-pf015-v1',
            },
            data: {
              status: 'FAILED',
              blockingCount: 1,
              findings: [{ code: 'ANONYMIZATION_PREFLIGHT_FAILED', severity: 'BLOCKING' }],
              finishedAt: new Date(),
            },
          });
        }
      }
    };
    const source = provenance(asset.provenance);
    await mkdir(config.FILE_QUARANTINE_DIR, { recursive: true, mode: 0o700 });
    const pendingPath = join(config.FILE_QUARANTINE_DIR, `${asset.id}.pending`);
    const quarantinePath = join(config.FILE_QUARANTINE_DIR, `${asset.id}.upload`);
    let downloaded: { sha256: string; sizeBytes: number } | undefined;
    if (
      asset.storageStatus === 'STORED' &&
      asset.scanStatus === 'CLEAN' &&
      asset.sha256 &&
      asset.objectKey
    ) {
      await mkdir(config.FILE_QUARANTINE_DIR, { recursive: true, mode: 0o700 });
      await rm(quarantinePath, { force: true });
      const stored = await s3.send(
        new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: asset.objectKey }),
      );
      if (!stored.Body) throw new Error('STORED_FILE_BODY_MISSING');
      const hash = createHash('sha256');
      let storedBytes = 0;
      const storedStream = Readable.from(stored.Body as AsyncIterable<Uint8Array>);
      storedStream.on('data', (chunk: Buffer) => {
        storedBytes += chunk.length;
        if (storedBytes > config.FILE_MAX_BYTES)
          storedStream.destroy(new Error('STORED_FILE_TOO_LARGE'));
        hash.update(chunk);
      });
      try {
        await pipeline(
          storedStream,
          createWriteStream(quarantinePath, { flags: 'wx', mode: 0o600 }),
        );
        if (storedBytes !== Number(asset.sizeBytes) || hash.digest('hex') !== asset.sha256)
          throw new Error('STORED_FILE_INTEGRITY_MISMATCH');
        const inspection = await inspectUpload(quarantinePath, asset.extension);
        await executePreflights(quarantinePath, inspection.format);
        await executeAnonymizationPreflights(quarantinePath, inspection.format);
        return { alreadyProcessed: true };
      } finally {
        await rm(quarantinePath, { force: true }).catch(() => undefined);
      }
    }
    const preserveRejectedFile = async (reason: string) => {
      if (!downloaded) throw new Error('QUARANTINE_SOURCE_MISSING');
      const extension = asset.extension ?? 'bin';
      const quarantineKey = `rejected/${asset.id}/${downloaded.sha256}.${extension}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_QUARANTINE_BUCKET,
          Key: quarantineKey,
          Body: createReadStream(quarantinePath),
          ContentType: 'application/octet-stream',
          ContentDisposition: 'attachment',
          ServerSideEncryption: 'AES256',
          Metadata: {
            sha256: downloaded.sha256,
            disposition: 'rejected',
            reason: reason.slice(0, 100),
          },
        }),
      );
      await database.fileAsset.update({
        where: { id: asset.id },
        data: {
          storageStatus: 'QUARANTINED',
          quarantineKey,
          sha256: downloaded.sha256,
          sizeBytes: BigInt(downloaded.sizeBytes),
        },
      });
    };
    try {
      try {
        const existing = await stat(quarantinePath);
        if (existing.size > config.FILE_MAX_BYTES) throw new UnrecoverableError('FILE_TOO_LARGE');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(quarantinePath)) hash.update(chunk as Buffer);
        downloaded = { sha256: hash.digest('hex'), sizeBytes: existing.size };
      } catch (error) {
        if (error instanceof UnrecoverableError) throw error;
        await rm(pendingPath, { force: true });
        if (!source.providerFileId) throw new UnrecoverableError('FILE_SOURCE_MISSING');
        downloaded = await downloadTelegramFile(config, source.providerFileId, pendingPath);
        await rename(pendingPath, quarantinePath);
      }
      if (downloaded.sizeBytes !== Number(asset.sizeBytes))
        throw new UnrecoverableError('FILE_SIZE_MISMATCH');
      await database.fileAsset.update({
        where: { id: asset.id },
        data: { storageStatus: 'QUARANTINED', quarantineKey: `local:worker/${asset.id}` },
      });
      await database.draftPreflightRun.updateMany({
        where: { fileId: asset.id, draftId: { in: asset.draftLinks.map((link) => link.draftId) } },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      await database.preflightRun.updateMany({
        where: { fileId: asset.id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      const inspection = await inspectUpload(quarantinePath, asset.extension).catch((error) => {
        throw new UnrecoverableError(
          error instanceof Error ? error.message : 'FILE_SIGNATURE_INVALID',
        );
      });
      assertDeclaredMime(asset.declaredMime, inspection.format);
      const scan = await scanFile(
        config.CLAMAV_HOST,
        config.CLAMAV_PORT,
        quarantinePath,
        config.FILE_SCAN_TIMEOUT_MS,
      );
      if (scan.status === 'INFECTED') {
        await preserveRejectedFile('MALWARE_DETECTED');
        await database.fileAsset.update({
          where: { id: asset.id },
          data: {
            scanStatus: 'INFECTED',
            detectedMime: inspection.detectedMime,
            sha256: downloaded.sha256,
          },
        });
        await database.draftPreflightRun.updateMany({
          where: { fileId: asset.id },
          data: {
            status: 'FAILED',
            blockingCount: 1,
            findings: [{ code: 'MALWARE_DETECTED', severity: 'BLOCKING' }],
            finishedAt: new Date(),
          },
        });
        throw new UnrecoverableError('MALWARE_DETECTED');
      }
      const objectKey = `ingest/${asset.id}/${downloaded.sha256}.${inspection.format}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: objectKey,
          Body: createReadStream(quarantinePath),
          ContentType: inspection.detectedMime,
          ContentDisposition: attachmentContentDisposition(asset.originalName),
          ServerSideEncryption: 'AES256',
          Metadata: { sha256: downloaded.sha256, scan: 'clean' },
        }),
      );
      await database.fileAsset.update({
        where: { id: asset.id },
        data: {
          objectKey,
          quarantineKey: null,
          detectedMime: inspection.detectedMime,
          sizeBytes: BigInt(downloaded.sizeBytes),
          sha256: downloaded.sha256,
          scanStatus: 'CLEAN',
          scanEngineVersion: scan.response.slice(0, 100),
          storageStatus: 'STORED',
          storedAt: new Date(),
        },
      });
      await executePreflights(quarantinePath, inspection.format);
      await executeAnonymizationPreflights(quarantinePath, inspection.format);
      return { objectKey, sha256: downloaded.sha256 };
    } catch (error) {
      if (error instanceof UnrecoverableError) {
        if (error.message !== 'MALWARE_DETECTED') {
          if (downloaded) {
            try {
              await preserveRejectedFile(error.message);
            } catch (quarantineError) {
              await database.fileAsset
                .update({ where: { id: asset.id }, data: { scanStatus: 'ERROR' } })
                .catch(() => undefined);
              throw new Error('QUARANTINE_STORE_FAILED', { cause: quarantineError });
            }
          }
          await database.fileAsset.update({
            where: { id: asset.id },
            data: { scanStatus: 'SUSPICIOUS' },
          });
        }
      } else {
        await database.fileAsset
          .update({
            where: { id: asset.id },
            data: {
              scanStatus:
                error instanceof Error && error.message === 'CLAMAV_TIMEOUT' ? 'TIMEOUT' : 'ERROR',
            },
          })
          .catch(() => undefined);
      }
      await database.draftPreflightRun
        .updateMany({
          where: { fileId: asset.id, status: { not: 'COMPLETED' } },
          data: {
            status: error instanceof UnrecoverableError ? 'FAILED' : 'PENDING',
            blockingCount: error instanceof UnrecoverableError ? 1 : 0,
            findings:
              error instanceof UnrecoverableError
                ? [{ code: error.message.slice(0, 100), severity: 'BLOCKING' }]
                : [],
            finishedAt: error instanceof UnrecoverableError ? new Date() : null,
          },
        })
        .catch(() => undefined);
      await database.preflightRun
        .updateMany({
          where: { fileId: asset.id, status: { not: 'COMPLETED' } },
          data: {
            status: error instanceof UnrecoverableError ? 'FAILED' : 'PENDING',
            blockingCount: error instanceof UnrecoverableError ? 1 : 0,
            findings:
              error instanceof UnrecoverableError
                ? [{ code: error.message.slice(0, 100), severity: 'BLOCKING' }]
                : [],
            finishedAt: error instanceof UnrecoverableError ? new Date() : null,
          },
        })
        .catch(() => undefined);
      throw error;
    } finally {
      await rm(pendingPath, { force: true }).catch(() => undefined);
      const refreshed = await database.fileAsset
        .findUnique({ where: { id: asset.id }, select: { storageStatus: true, scanStatus: true } })
        .catch(() => null);
      if (
        refreshed?.storageStatus === 'STORED' ||
        refreshed?.scanStatus === 'INFECTED' ||
        refreshed?.scanStatus === 'SUSPICIOUS'
      )
        await rm(quarantinePath, { force: true }).catch(() => undefined);
    }
  };
}
