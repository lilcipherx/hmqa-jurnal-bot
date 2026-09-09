import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const base = parse(readFileSync('docker-compose.yml', 'utf8'), { merge: true });
const test = parse(readFileSync('docker-compose.test.yml', 'utf8'), { merge: true });
const dockerfile = readFileSync('infrastructure/docker/Dockerfile', 'utf8');
const backupDockerfile = readFileSync('infrastructure/docker/backup.Dockerfile', 'utf8');
const backupScript = readFileSync('infrastructure/backup/backup.sh', 'utf8');
const restoreScript = readFileSync('infrastructure/backup/restore.sh', 'utf8');
const innerNginx = readFileSync('infrastructure/nginx/nginx.conf', 'utf8');
const hostNginx = readFileSync('infrastructure/nginx/hmqa-staging.conf', 'utf8');
const requiredServices = [
  'postgres',
  'redis',
  'minio',
  'minio-init',
  'clamav',
  'migrate',
  'api',
  'bot',
  'worker',
  'admin-web',
  'nginx',
  'backup',
];
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(base?.name === 'hmqa-jurnal-bot', 'Compose project name must be explicit');
for (const service of requiredServices) {
  assert(Boolean(base?.services?.[service]), `Missing production service: ${service}`);
}

const productionServices = Object.keys(base?.services ?? {});
for (const [name, service] of Object.entries(base?.services ?? {})) {
  if (service.image) {
    assert(!/(^|:)latest$/.test(service.image), `${name} uses an unpinned latest image`);
    assert(service.image.includes(':'), `${name} image has no explicit version tag`);
  }
  const dependencies = Array.isArray(service.depends_on)
    ? service.depends_on
    : Object.keys(service.depends_on ?? {});
  for (const dependency of dependencies) {
    assert(
      productionServices.includes(dependency),
      `${name} depends on unknown service ${dependency}`,
    );
  }
}

for (const dependency of ['postgres', 'redis', 'minio']) {
  assert(Boolean(base.services[dependency]?.healthcheck), `${dependency} needs a healthcheck`);
}
for (const service of ['api', 'bot', 'worker', 'admin-web']) {
  assert(
    base.services[service]?.restart === 'unless-stopped',
    `${service} restart policy is missing`,
  );
}
for (const [name, service] of Object.entries(base.services)) {
  if (name !== 'nginx') assert(!service.ports, `${name} must not publish host ports`);
}
assert(base.services.worker?.read_only === true, 'Worker filesystem must be read-only');
assert(
  base.services.worker?.security_opt?.includes('no-new-privileges:true'),
  'Worker must disable privilege escalation',
);
assert(base.services.worker?.cap_drop?.includes('ALL'), 'Worker must drop Linux capabilities');
assert(
  Boolean(base.services.redis?.environment?.REDISCLI_AUTH) &&
    String(base.services.redis?.command).includes('--requirepass'),
  'Redis must require authenticated clients',
);
assert(
  Boolean(base.services.minio?.environment?.MINIO_KMS_SECRET_KEY),
  'MinIO must require a KMS secret key for server-side encryption',
);
assert(
  String(base.services['minio-init']?.command).includes('mc encrypt set sse-s3'),
  'Production MinIO buckets must enforce default server-side encryption',
);
assert(
  (String(base.services['minio-init']?.command).match(/mc version enable/g) ?? []).length === 2,
  'Production clean and quarantine buckets must both enable object versioning',
);
assert(
  (base.services.backup?.volumes ?? []).some((mount) =>
    String(mount).endsWith(':/var/lib/hmqa/restic'),
  ),
  'Backup must persist a local restic repository outside disposable run containers',
);
assert(base.networks?.backend, 'Backend network is missing');

for (const service of [
  'clamav-signature-init',
  'telegram-stub',
  'runtime-tests',
  'browser-tests',
  'postgres-recovery',
  'minio-recovery',
]) {
  assert(Boolean(test?.services?.[service]), `Missing verification-only service: ${service}`);
}
for (const service of ['migrate', 'api', 'bot', 'worker', 'admin-web']) {
  assert(
    base.services[service]?.build?.args?.DEPLOYED_SHA,
    `${service} image must carry the deployed Git revision build argument`,
  );
}
assert(
  base.services.backup?.build?.args?.DEPLOYED_SHA,
  'backup image must carry the deployed Git revision build argument',
);
assert(test.services['telegram-stub']?.build?.target === 'verification', 'Telegram fixture target');
assert(test.services['runtime-tests']?.build?.target === 'verification', 'Runtime test target');
assert(
  test.services['browser-tests']?.build?.target === 'browser-verification',
  'Browser test target',
);
assert(
  test.services['clamav-signature-init']?.volumes?.some((volume) =>
    String(volume).includes('tests/fixtures'),
  ),
  'Runtime ClamAV must stage the deterministic EICAR signature fixture',
);
assert(
  test.services.clamav?.depends_on?.['clamav-signature-init']?.condition ===
    'service_completed_successfully',
  'Runtime ClamAV must start only after its signature fixture is staged',
);
assert(
  Boolean(test.services['minio-recovery']?.environment?.MINIO_KMS_SECRET_KEY),
  'Recovery MinIO must enable server-side encryption',
);
assert(
  String(test.services['minio-recovery-init']?.command).includes('mc encrypt set sse-s3'),
  'Recovery MinIO buckets must enforce default server-side encryption',
);

assert(
  /FROM runtime-base AS runtime\s*[\s\S]*USER node\s*[\s\S]*CMD/.test(dockerfile),
  'Runtime image must end as node',
);
assert(!/COPY[^\n]*\.env/i.test(dockerfile), 'Runtime image must not copy environment files');
assert(
  /ENTRYPOINT \["\/usr\/local\/bin\/hmqa-backup"\]/.test(backupDockerfile),
  'Backup entrypoint missing',
);
assert(
  /ARG DEPLOYED_SHA=development[\s\S]*LABEL org\.opencontainers\.image\.revision=\$DEPLOYED_SHA/.test(
    backupDockerfile,
  ),
  'Backup image must expose its source revision',
);
assert(
  /restic forget[\s\S]*--tag hmqa[\s\S]*--group-by tags[\s\S]*--keep-daily[\s\S]*--prune/.test(
    backupScript,
  ),
  'Backup retention must group ephemeral-container snapshots by tag',
);
assert(
  /sha256sum -c postgres\.dump\.sha256/.test(restoreScript) &&
    /sha256sum -c objects\.sha256/.test(restoreScript),
  'Restore checksums must use the BusyBox-compatible sha256sum -c option',
);
assert(
  !/sha256sum --check/.test(restoreScript),
  'Restore checksums must not use GNU-only sha256sum options',
);
assert(
  /resolver 127\.0\.0\.11[\s\S]*server api:3001 resolve;[\s\S]*server bot:3002 resolve;[\s\S]*server admin-web:3000 resolve;/.test(
    innerNginx,
  ),
  'Application gateway must re-resolve recreated Docker upstreams',
);
assert(
  /location \/documentation[\s\S]*proxy_pass http:\/\/api;/.test(innerNginx),
  'Application gateway must route OpenAPI documentation to the API',
);
assert(/listen 443 ssl;/.test(hostNginx), 'Host nginx must terminate TLS');
assert(
  /ssl_protocols TLSv1\.2 TLSv1\.3;/.test(hostNginx),
  'Host nginx must permit only TLS 1.2 and TLS 1.3',
);
assert(
  /return 308 https:\/\/\$host\$request_uri;/.test(hostNginx),
  'Host nginx must redirect HTTP to HTTPS',
);
assert(
  /proxy_pass http:\/\/127\.0\.0\.1:8080;/.test(hostNginx),
  'Host nginx must proxy only to the loopback-bound application gateway',
);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
process.stdout.write(
  'Compose and Docker static validation passed. Docker runtime validation is still required.\n',
);
