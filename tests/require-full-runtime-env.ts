const required = [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_QUARANTINE_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'CLAMAV_HOST',
  'CLAMAV_PORT',
  'FILE_QUARANTINE_DIR',
  'LIBREOFFICE_PATH',
] as const;

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(`Full runtime test environment is missing: ${missing.join(', ')}`);
}
