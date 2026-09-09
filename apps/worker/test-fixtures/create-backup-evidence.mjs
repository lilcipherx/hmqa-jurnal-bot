import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadConfig } from '@hmqa/config';
import { createPrismaClient } from '@hmqa/database';

const config = loadConfig();
const database = createPrismaClient(config.DATABASE_URL);
const storage = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});
const body = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n% DEV/TEST ONLY — REQUIRES ACADEMY APPROVAL\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
const sha256 = createHash('sha256').update(body).digest('hex');
const objectKey = `runtime-evidence/${sha256}.pdf`;

try {
  await storage.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: 'application/pdf',
      ContentDisposition: 'attachment; filename="dev-test-backup-evidence.pdf"',
      ServerSideEncryption: 'AES256',
      Metadata: { sha256, scan: 'clean', fixture: 'dev-test-only' },
    }),
  );
  await database.fileAsset.upsert({
    where: { sourceKey: 'runtime:backup-evidence' },
    update: {
      objectKey,
      sha256,
      sizeBytes: BigInt(body.length),
      scanStatus: 'CLEAN',
      storageStatus: 'STORED',
      storedAt: new Date(),
    },
    create: {
      sourceKey: 'runtime:backup-evidence',
      objectKey,
      originalName: 'dev-test-backup-evidence.pdf',
      declaredMime: 'application/pdf',
      detectedMime: 'application/pdf',
      extension: 'pdf',
      sizeBytes: BigInt(body.length),
      sha256,
      scanStatus: 'CLEAN',
      scanEngineVersion: 'DEV_TEST_ONLY_PREVERIFIED_FIXTURE',
      storageStatus: 'STORED',
      storedAt: new Date(),
      provenance: { provider: 'runtime-fixture', approval: 'ACADEMY_REQUIRED' },
    },
  });
  process.stdout.write(`DEV/TEST ONLY backup evidence created: ${objectKey}\n`);
} finally {
  storage.destroy();
  await database.$disconnect();
}
