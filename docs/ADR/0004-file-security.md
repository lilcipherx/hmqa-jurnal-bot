# ADR 0004 Quarantine-first immutable object storage

Status: Accepted

All Telegram files first enter a bounded ephemeral processing directory. The worker validates the pinned requirement category, size, extension, magic MIME, checksum, antivirus result, and DOCX/PDF container safety before writing an immutable object to private clean S3 storage. A scanner error is fail-closed. Rejected or malicious evidence is encrypted into a separate private quarantine bucket and cannot be signed by application download routes. Originals are never overwritten; every replacement creates a new asset and version link.

S3 writes request server-side encryption. The bundled MinIO deployment enables its KMS with an independently generated `MINIO_KMS_SECRET_KEY`; this key is a deployment secret and must be escrowed with the encrypted object backup. Managed S3 deployments must provide an equivalent KMS-backed private/versioned bucket policy. A deployment that cannot satisfy encrypted writes fails closed instead of storing plaintext.
