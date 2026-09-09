import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const base = parse(readFileSync('docker-compose.yml', 'utf8'), { merge: true });
const test = parse(readFileSync('docker-compose.test.yml', 'utf8'), { merge: true });
const dockerfile = readFileSync('infrastructure/docker/Dockerfile', 'utf8');
const backupDockerfile = readFileSync('infrastructure/docker/backup.Dockerfile', 'utf8');
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
assert(base.networks?.backend, 'Backend network is missing');

for (const service of ['telegram-stub', 'runtime-tests', 'postgres-recovery', 'minio-recovery']) {
  assert(Boolean(test?.services?.[service]), `Missing verification-only service: ${service}`);
}
assert(test.services['telegram-stub']?.build?.target === 'verification', 'Telegram fixture target');
assert(test.services['runtime-tests']?.build?.target === 'verification', 'Runtime test target');

assert(
  /FROM runtime-base AS runtime\s*[\s\S]*USER node\s*[\s\S]*CMD/.test(dockerfile),
  'Runtime image must end as node',
);
assert(!/COPY[^\n]*\.env/i.test(dockerfile), 'Runtime image must not copy environment files');
assert(
  /ENTRYPOINT \["\/usr\/local\/bin\/hmqa-backup"\]/.test(backupDockerfile),
  'Backup entrypoint missing',
);

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
process.stdout.write(
  'Compose and Docker static validation passed. Docker runtime validation is still required.\n',
);
