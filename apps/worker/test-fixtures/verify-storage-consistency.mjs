import { createHash } from 'node:crypto';
import process from 'node:process';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
const requireHashMetadata = process.env.REQUIRE_S3_SHA256_METADATA !== 'false';

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
    if (
      (requireHashMetadata || head.Metadata?.sha256 !== undefined) &&
      head.Metadata?.sha256 !== asset.sha256
    )
      throw new Error(`SHA-256 metadata mismatch for FileAsset ${asset.id}`);
    if (head.ContentLength !== Number(asset.sizeBytes))
      throw new Error(`Size metadata mismatch for FileAsset ${asset.id}`);
    if (head.ServerSideEncryption !== 'AES256')
      throw new Error(`Server-side encryption missing for FileAsset ${asset.id}`);

    const object = await storage.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: asset.objectKey }),
    );
    if (!object.Body) throw new Error(`Object body missing for FileAsset ${asset.id}`);
    const digest = createHash('sha256');
    let downloadedBytes = 0;
    for await (const chunk of object.Body) {
      digest.update(chunk);
      downloadedBytes += chunk.length;
    }
    if (downloadedBytes !== Number(asset.sizeBytes))
      throw new Error(`Downloaded size mismatch for FileAsset ${asset.id}`);
    if (digest.digest('hex') !== asset.sha256)
      throw new Error(`Object content checksum mismatch for FileAsset ${asset.id}`);
  }
  process.stdout.write(`DB/object consistency verified for ${assets.length} stored object(s)\n`);
} finally {
  storage.destroy();
  await database.$disconnect();
}
