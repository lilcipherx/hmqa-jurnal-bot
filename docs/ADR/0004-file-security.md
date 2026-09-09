# ADR 0004 Quarantine-first immutable object storage

Status: Accepted

All Telegram files first enter a bounded ephemeral processing directory. The worker validates the pinned requirement category, size, extension, magic MIME, checksum, antivirus result, and DOCX/PDF container safety before writing an immutable object to private clean S3 storage. A scanner error is fail-closed. Rejected or malicious evidence is encrypted into a separate private quarantine bucket and cannot be signed by application download routes. Originals are never overwritten; every replacement creates a new asset and version link.
