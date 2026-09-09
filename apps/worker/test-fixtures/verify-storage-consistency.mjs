import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

try {
  const assets = await database.fileAsset.findMany({
    where: {
      storageStatus: 'STORED',
      scanStatus: 'CLEAN',
      objectKey: { not: null },
      deletedAt: null,
    },
    select: { id: true, objectKey: true, sha256: true, sizeBytes: true },
  });
  if (assets.length === 0) throw new Error('No clean stored file metadata exists to verify');
  for (const asset of assets) {
    const head = await storage.send(
      new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: asset.objectKey }),
    );
    if (head.Metadata?.sha256 !== asset.sha256)
      throw new Error(`SHA-256 metadata mismatch for FileAsset ${asset.id}`);
    if (head.ContentLength !== Number(asset.sizeBytes))
      throw new Error(`Size metadata mismatch for FileAsset ${asset.id}`);
    if (head.ServerSideEncryption !== 'AES256')
      throw new Error(`Server-side encryption missing for FileAsset ${asset.id}`);
  }
  process.stdout.write(`DB/object consistency verified for ${assets.length} stored object(s)\n`);
} finally {
  storage.destroy();
  await database.$disconnect();
}
