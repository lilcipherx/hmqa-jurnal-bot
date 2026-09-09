import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { AppConfig } from '@hmqa/config';
import type { DatabaseClient } from '@hmqa/database';
import type { Locale } from '@hmqa/i18n';
import type { Job } from 'bullmq';
import { generateReceiptPdf } from './receipt-generator.js';

function publicLocale(locale: 'uz_Latn' | 'ru' | 'en'): Locale {
  return locale === 'uz_Latn' ? 'uz-Latn' : locale;
}

export function createReceiptProcessor(config: AppConfig, database: DatabaseClient, s3: S3Client) {
  return async (job: Job<{ receiptId: string }>) => {
    const receipt = await database.submissionReceipt.findUnique({
      where: { id: job.data.receiptId },
      include: { submissionVersion: { include: { submission: true } } },
    });
    if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
    if (receipt.status === 'READY' && receipt.fileId) return { alreadyReady: true };
    const claimed = await database.submissionReceipt.updateMany({
      where: { id: receipt.id, status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, failureCode: null },
    });
    if (claimed.count !== 1) return { skipped: true };

    try {
      const fontBytes = await readFile(config.RECEIPT_FONT_PATH);
      const bytes = await generateReceiptPdf(
        receipt.dataSnapshot,
        publicLocale(receipt.locale),
        config.APP_TIMEZONE,
        fontBytes,
      );
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const submission = receipt.submissionVersion.submission;
      const objectKey = `derived/receipts/${submission.id}/v${receipt.submissionVersion.versionNo}/${receipt.id}-${sha256}.pdf`;
      let objectExists = false;
      try {
        const existing = await s3.send(
          new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: objectKey }),
        );
        objectExists = existing.Metadata?.sha256 === sha256;
      } catch {
        objectExists = false;
      }
      if (!objectExists)
        await s3.send(
          new PutObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: objectKey,
            Body: bytes,
            ContentType: 'application/pdf',
            ContentDisposition: `attachment; filename="receipt-${submission.publicId}-v${receipt.submissionVersion.versionNo}.pdf"`,
            ServerSideEncryption: 'AES256',
            Metadata: { sha256, kind: 'submission-receipt', receiptid: receipt.id },
          }),
        );

      const file = await database.$transaction(async (tx) => {
        const asset = await tx.fileAsset.upsert({
          where: { objectKey },
          update: {},
          create: {
            objectKey,
            originalName: `receipt-${submission.publicId}-v${receipt.submissionVersion.versionNo}.pdf`,
            declaredMime: 'application/pdf',
            detectedMime: 'application/pdf',
            extension: 'pdf',
            sizeBytes: BigInt(bytes.byteLength),
            sha256,
            scanStatus: 'CLEAN',
            storageStatus: 'STORED',
            storedAt: new Date(),
            provenance: {
              source: 'GENERATED',
              kind: 'SUBMISSION_RECEIPT',
              receiptId: receipt.id,
              templateVersion: receipt.templateVersion,
            },
          },
        });
        await tx.submissionReceipt.update({
          where: { id: receipt.id },
          data: { status: 'READY', fileId: asset.id, readyAt: new Date(), failureCode: null },
        });
        return asset;
      });
      return { fileId: file.id, sha256 };
    } catch (error) {
      const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await database.submissionReceipt.updateMany({
        where: { id: receipt.id, status: 'PROCESSING' },
        data: {
          status: exhausted ? 'FAILED' : 'PROCESSING',
          failureCode: (error instanceof Error ? error.message : 'UNKNOWN').slice(0, 150),
        },
      });
      throw error;
    }
  };
}
