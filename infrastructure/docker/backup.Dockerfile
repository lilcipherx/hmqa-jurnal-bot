FROM minio/mc:RELEASE.2025-07-21T05-28-08Z AS minio-client
FROM postgres:17.6-alpine
ARG DEPLOYED_SHA=development
LABEL org.opencontainers.image.revision=$DEPLOYED_SHA
RUN apk add --no-cache bash ca-certificates restic
COPY --from=minio-client /usr/bin/mc /usr/local/bin/mc
COPY infrastructure/backup/backup.sh /usr/local/bin/hmqa-backup
COPY infrastructure/backup/restore.sh /usr/local/bin/hmqa-restore
RUN chmod 0555 /usr/local/bin/hmqa-backup /usr/local/bin/hmqa-restore
ENTRYPOINT ["/usr/local/bin/hmqa-backup"]
