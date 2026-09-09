import { createWriteStream } from 'node:fs';
import { chmod, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { loadConfig, type AppConfig } from '@hmqa/config';
import { docxPreflightPolicySchema } from '@hmqa/contracts';
import { createPrismaClient } from '@hmqa/database';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import { pingClamAv } from './clamav.js';
import { createFileProcessor } from './file-processor.js';
import { renderDocxPageCount, runDocxPreflight } from './docx-preflight.js';

const config = loadConfig();
const database = createPrismaClient(config.DATABASE_URL);
const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});
const createdAssetIds: string[] = [];
const cleanObjectKeys: string[] = [];
const quarantineObjectKeys: string[] = [];
const localPaths: string[] = [];

function passivePdf(extra = ''): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    'latin1',
  );
}

async function createLocalAsset(
  bytes: Buffer,
  name: string,
  extension = 'pdf',
  declaredMime: string | null = 'application/pdf',
) {
  const asset = await database.fileAsset.create({
    data: {
      originalName: name,
      declaredMime,
      extension,
      sizeBytes: BigInt(bytes.length),
      provenance: { provider: 'admin-derived-upload' },
    },
  });
  createdAssetIds.push(asset.id);
  const path = join(config.FILE_QUARANTINE_DIR, `${asset.id}.upload`);
  localPaths.push(path);
  await writeFile(path, bytes, { mode: 0o600 });
  return asset;
}

async function processAsset(
  assetId: string,
  processorConfig: AppConfig = config,
  storage: S3Client = s3,
) {
  const processor = createFileProcessor(processorConfig, database, storage);
  return processor({ data: { fileAssetId: assetId } } as Job<{ fileAssetId: string }>);
}

function addXml(zip: ZipFile, path: string, value: string): void {
  zip.addBuffer(Buffer.from(value, 'utf8'), path, { mtime: new Date('2026-01-01T00:00:00Z') });
}

async function createMinimalDocx(path: string): Promise<void> {
  const zip = new ZipFile();
  addXml(
    zip,
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  addXml(
    zip,
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  addXml(
    zip,
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Runtime verification manuscript</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1701" w:right="850" w:top="1134" w:bottom="1134"/></w:sectPr></w:body></w:document>',
  );
  addXml(
    zip,
    'word/styles.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/></w:rPr></w:style></w:styles>',
  );
  const output = createWriteStream(path, { flags: 'wx', mode: 0o600 });
  const completed = new Promise<void>((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    zip.once('error', reject);
  });
  zip.outputStream.pipe(output);
  zip.end();
  await completed;
}

beforeAll(async () => {
  await mkdir(config.FILE_QUARANTINE_DIR, { recursive: true, mode: 0o700 });
  await Promise.all([
    database.$queryRaw`SELECT 1`,
    s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })),
    s3.send(new HeadBucketCommand({ Bucket: config.S3_QUARANTINE_BUCKET })),
  ]);
  const deadline = Date.now() + 150_000;
  while (!(await pingClamAv(config.CLAMAV_HOST, config.CLAMAV_PORT, 2_000))) {
    if (Date.now() >= deadline) throw new Error('CLAMAV_NOT_READY_AFTER_150_SECONDS');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
});

async function deleteAllObjectVersions(Key: string): Promise<void> {
  const listed = await s3.send(
    new ListObjectVersionsCommand({ Bucket: config.S3_BUCKET, Prefix: Key }),
  );
  const Objects = [...(listed.Versions ?? []), ...(listed.DeleteMarkers ?? [])]
    .filter((item) => item.Key === Key && item.VersionId)
    .map((item) => ({ Key, VersionId: item.VersionId! }));
  if (Objects.length > 0)
    await s3.send(
      new DeleteObjectsCommand({ Bucket: config.S3_BUCKET, Delete: { Objects, Quiet: true } }),
    );
}

afterAll(async () => {
  if (createdAssetIds.length > 0)
    await database.fileAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
  await Promise.all([
    ...cleanObjectKeys.map((Key) => deleteAllObjectVersions(Key)),
    ...quarantineObjectKeys.map((Key) =>
      s3.send(new DeleteObjectCommand({ Bucket: config.S3_QUARANTINE_BUCKET, Key })),
    ),
    ...localPaths.map((path) => rm(path, { force: true })),
  ]);
  s3.destroy();
  await database.$disconnect();
});

describe('real file-security runtime', () => {
  it('validates, scans, hashes, and promotes a clean PDF into private versioned S3', async () => {
    const asset = await createLocalAsset(passivePdf(), '..\\private/статья"\r\nX-Evil: yes.pdf');
    const result = await processAsset(asset.id);
    if (!('objectKey' in result)) throw new Error('Expected a newly stored object');
    cleanObjectKeys.push(result.objectKey);

    const [stored, head, versioning] = await Promise.all([
      database.fileAsset.findUniqueOrThrow({ where: { id: asset.id } }),
      s3.send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: result.objectKey })),
      s3.send(new GetBucketVersioningCommand({ Bucket: config.S3_BUCKET })),
    ]);
    expect(stored).toMatchObject({
      scanStatus: 'CLEAN',
      storageStatus: 'STORED',
      detectedMime: 'application/pdf',
      sha256: result.sha256,
      quarantineKey: null,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(head.ServerSideEncryption).toBe('AES256');
    expect(head.Metadata?.sha256).toBe(result.sha256);
    expect(head.ContentDisposition).not.toMatch(/[\r\n]/);
    expect(head.ContentDisposition).not.toContain('..');
    expect(head.ContentDisposition).toContain("filename*=UTF-8''");
    expect(versioning.Status).toBe('Enabled');

    const anonymous = await fetch(`${config.S3_ENDPOINT}/${config.S3_BUCKET}/${result.objectKey}`);
    expect([401, 403]).toContain(anonymous.status);

    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: result.objectKey }),
      { expiresIn: 1 },
    );
    expect((await fetch(signedUrl)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect((await fetch(signedUrl)).status).toBe(403);

    await expect(processAsset(asset.id)).resolves.toEqual({ alreadyProcessed: true });
    const versions = await s3.send(
      new ListObjectVersionsCommand({ Bucket: config.S3_BUCKET, Prefix: result.objectKey }),
    );
    expect(versions.Versions?.filter((item) => item.Key === result.objectKey)).toHaveLength(1);
  });

  it('keeps an EICAR-bearing PDF in quarantine and never promotes it', async () => {
    const eicar = [
      'X5O!P%@AP[4\\PZX54(P^)7CC)7}$',
      'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!',
      '$H+H*',
    ].join('');
    const asset = await createLocalAsset(passivePdf(`% ${eicar}`), 'runtime-infected.pdf');
    await expect(processAsset(asset.id)).rejects.toThrow('MALWARE_DETECTED');
    const stored = await database.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored).toMatchObject({
      scanStatus: 'INFECTED',
      storageStatus: 'QUARANTINED',
      objectKey: null,
    });
    expect(stored.quarantineKey).toMatch(/^rejected\//);
    quarantineObjectKeys.push(stored.quarantineKey!);
    const quarantined = await s3.send(
      new HeadObjectCommand({ Bucket: config.S3_QUARANTINE_BUCKET, Key: stored.quarantineKey! }),
    );
    expect(quarantined.ServerSideEncryption).toBe('AES256');
    expect(quarantined.Metadata?.disposition).toBe('rejected');
  });

  it('fails closed when ClamAV is unreachable and does not create a clean object', async () => {
    const asset = await createLocalAsset(passivePdf(), 'runtime-antivirus-down.pdf');
    const unavailableConfig = {
      ...config,
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: 9,
      FILE_SCAN_TIMEOUT_MS: 1_000,
    } satisfies AppConfig;
    await expect(processAsset(asset.id, unavailableConfig)).rejects.toThrow();
    const stored = await database.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored).toMatchObject({
      scanStatus: 'ERROR',
      storageStatus: 'QUARANTINED',
      objectKey: null,
    });
  });

  it('records antivirus timeouts as retryable and keeps the source in quarantine', async () => {
    const connections = new Set<Socket>();
    const server = createServer((socket) => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_MISSING');
    const asset = await createLocalAsset(passivePdf(), 'runtime-antivirus-timeout.pdf');
    const timeoutConfig = {
      ...config,
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: address.port,
      FILE_SCAN_TIMEOUT_MS: 1_000,
    } satisfies AppConfig;
    try {
      await expect(processAsset(asset.id, timeoutConfig)).rejects.toThrow('CLAMAV_TIMEOUT');
      const stored = await database.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(stored).toMatchObject({
        scanStatus: 'TIMEOUT',
        storageStatus: 'QUARANTINED',
        objectKey: null,
      });
    } finally {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('quarantines invalid extension/MIME and fails a missing or oversized source safely', async () => {
    const invalidExtension = await createLocalAsset(passivePdf(), 'runtime-invalid.exe', 'exe');
    await expect(processAsset(invalidExtension.id)).rejects.toThrow('FILE_FORMAT_NOT_SUPPORTED');
    const extensionState = await database.fileAsset.findUniqueOrThrow({
      where: { id: invalidExtension.id },
    });
    expect(extensionState).toMatchObject({
      scanStatus: 'SUSPICIOUS',
      storageStatus: 'QUARANTINED',
    });
    quarantineObjectKeys.push(extensionState.quarantineKey!);

    const wrongMime = await createLocalAsset(
      passivePdf(),
      'runtime-wrong-mime.pdf',
      'pdf',
      'text/plain',
    );
    await expect(processAsset(wrongMime.id)).rejects.toThrow('DECLARED_MIME_MISMATCH');
    const mimeState = await database.fileAsset.findUniqueOrThrow({ where: { id: wrongMime.id } });
    expect(mimeState).toMatchObject({
      scanStatus: 'SUSPICIOUS',
      storageStatus: 'QUARANTINED',
    });
    quarantineObjectKeys.push(mimeState.quarantineKey!);

    const oversized = await createLocalAsset(Buffer.alloc(128, 1), 'runtime-oversized.pdf');
    const smallLimit = { ...config, FILE_MAX_BYTES: 64 } satisfies AppConfig;
    await expect(processAsset(oversized.id, smallLimit)).rejects.toThrow('FILE_TOO_LARGE');
    expect(
      await database.fileAsset.findUniqueOrThrow({ where: { id: oversized.id } }),
    ).toMatchObject({ scanStatus: 'SUSPICIOUS', storageStatus: 'PENDING', objectKey: null });

    const missing = await database.fileAsset.create({
      data: {
        originalName: 'runtime-missing.pdf',
        declaredMime: 'application/pdf',
        extension: 'pdf',
        sizeBytes: 100n,
        provenance: { provider: 'admin-derived-upload' },
      },
    });
    createdAssetIds.push(missing.id);
    await expect(processAsset(missing.id)).rejects.toThrow('FILE_SOURCE_MISSING');
    expect(await database.fileAsset.findUniqueOrThrow({ where: { id: missing.id } })).toMatchObject(
      { scanStatus: 'SUSPICIOUS', storageStatus: 'PENDING', objectKey: null },
    );
  });

  it('keeps a clean scanned file quarantined when permanent storage is unavailable', async () => {
    const asset = await createLocalAsset(passivePdf(), 'runtime-storage-down.pdf');
    const unavailableStorage = new S3Client({
      endpoint: 'http://127.0.0.1:9',
      region: config.S3_REGION,
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: { accessKeyId: 'runtime', secretAccessKey: 'runtime-only' },
    });
    try {
      await expect(processAsset(asset.id, config, unavailableStorage)).rejects.toThrow();
      const stored = await database.fileAsset.findUniqueOrThrow({ where: { id: asset.id } });
      expect(stored).toMatchObject({
        scanStatus: 'ERROR',
        storageStatus: 'QUARANTINED',
        objectKey: null,
      });
      await expect(
        stat(join(config.FILE_QUARANTINE_DIR, `${asset.id}.upload`)),
      ).resolves.toBeDefined();
    } finally {
      unavailableStorage.destroy();
    }
  });

  it('recovers versioned object content after an accidental delete marker', async () => {
    const Key = `runtime-versioning/${crypto.randomUUID()}.txt`;
    cleanObjectKeys.push(Key);
    const first = await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key,
        Body: 'v1',
        ServerSideEncryption: 'AES256',
      }),
    );
    const second = await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key,
        Body: 'v2',
        ServerSideEncryption: 'AES256',
      }),
    );
    expect(first.VersionId).toBeTruthy();
    expect(second.VersionId).toBeTruthy();
    expect(first.VersionId).not.toBe(second.VersionId);
    await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key }));
    await expect(
      s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key })),
    ).rejects.toThrow();
    const recovered = await s3.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key, VersionId: second.VersionId }),
    );
    expect(await recovered.Body?.transformToString()).toBe('v2');
  });
});

describe('real LibreOffice runtime', () => {
  it('renders a valid DOCX and applies the configured preflight policy', async () => {
    const path = join(config.FILE_QUARANTINE_DIR, `runtime-${crypto.randomUUID()}.docx`);
    localPaths.push(path);
    await createMinimalDocx(path);
    expect((await stat(path)).size).toBeGreaterThan(100);
    const pages = await renderDocxPageCount(path, config.LIBREOFFICE_PATH, 60_000);
    expect(pages).toBeGreaterThanOrEqual(1);
    const policy = docxPreflightPolicySchema.parse({
      rulesVersion: 'runtime-v1',
      renderedPages: { min: 1, max: 2, severity: 'ERROR' },
      page: { widthMm: 210, heightMm: 297, toleranceMm: 1, severity: 'ERROR' },
      margins: {
        leftMm: 30,
        rightMm: 15,
        topMm: 20,
        bottomMm: 20,
        toleranceMm: 1,
        severity: 'ERROR',
      },
      defaultFont: {
        family: 'Times New Roman',
        sizePt: 14,
        tolerancePt: 0.5,
        severity: 'WARNING',
      },
      lineSpacing: { multiple: 1.5, tolerance: 0.05, severity: 'WARNING' },
      requiredMarkers: [],
    });
    const result = await runDocxPreflight(path, policy, {
      executable: config.LIBREOFFICE_PATH,
      timeoutMs: 60_000,
    });
    expect(result.statistics.renderedPageCount).toBe(pages);
    expect(result.blockingCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('rejects a corrupt DOCX and reports unavailable/timeout renderers', async () => {
    const corrupt = join(config.FILE_QUARANTINE_DIR, `corrupt-${crypto.randomUUID()}.docx`);
    const valid = join(config.FILE_QUARANTINE_DIR, `timeout-${crypto.randomUUID()}.docx`);
    const slow = join(config.FILE_QUARANTINE_DIR, `slow-${crypto.randomUUID()}.sh`);
    localPaths.push(corrupt, valid, slow);
    await writeFile(corrupt, 'not-a-zip', { mode: 0o600 });
    await createMinimalDocx(valid);
    await writeFile(slow, '#!/bin/sh\nsleep 30\n', { mode: 0o700 });
    await chmod(slow, 0o700);
    const policy = docxPreflightPolicySchema.parse({
      rulesVersion: 'runtime-corrupt-v1',
      requiredMarkers: [],
    });
    await expect(
      runDocxPreflight(corrupt, policy, {
        executable: config.LIBREOFFICE_PATH,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow();
    await expect(renderDocxPageCount(valid, '/missing/soffice', 5_000)).rejects.toThrow(
      'DOCX_RENDER_PROCESS_FAILED',
    );
    await expect(renderDocxPageCount(valid, slow, 200)).rejects.toThrow(
      'DOCX_RENDER_PROCESS_FAILED',
    );
  });
});
