import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const projectName = process.env.HMQA_RUNTIME_PROJECT ?? 'hmqa-local-verification';
if (!/^hmqa-(?:local-)?verification(?:-[a-z0-9-]+)?$/.test(projectName))
  throw new Error('HMQA_RUNTIME_PROJECT must be an isolated hmqa-verification project name');
const environmentFile = resolve('.env.test.example');
const reportDirectory = resolve('.codex-temp', 'runtime-verification');
const browserResultsDirectory = resolve('.codex-temp', 'browser-results');
const reportPath = resolve(reportDirectory, 'report.json');
const keepStack = process.env.KEEP_RUNTIME_STACK === 'true';
const runtimeProcessEnvironment = {
  ...process.env,
  HTTP_PORT: process.env.HMQA_RUNTIME_HTTP_PORT ?? '0',
};
const composePrefix = [
  'compose',
  '--project-name',
  projectName,
  '--env-file',
  environmentFile,
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.test.yml',
  '--profile',
  'runtime',
];
const evidence = {
  schemaVersion: 1,
  projectName,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  outcome: 'RUNNING',
  checks: [],
  blocker: null,
  diagnostics: null,
};

const diagnosticSecrets = [
  '123456:test-only-token',
  'test-only-webhook-secret-32-characters',
  'test-only-postgres-password',
  'test-only-redis-password-32-characters',
  'test-only-minio-secret-key',
  'test-only-service-secret-32-characters',
  'test-only-session-secret-32-characters',
  'test-only-encryption-key-32-characters',
  'Test-only-admin-password-2026!',
  'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  'test-only-restic-password-32-characters',
  'test-only-backup-secret',
];

function redactDiagnostics(value) {
  return diagnosticSecrets.reduce(
    (redacted, secret) => redacted.replaceAll(secret, '[REDACTED]'),
    value,
  );
}

function record(label, status, startedAt) {
  evidence.checks.push({ label, status, durationMs: Date.now() - startedAt });
}

function execute(command, args, options = {}) {
  const startedAt = Date.now();
  process.stdout.write(`\n[runtime] ${options.label ?? command}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: runtimeProcessEnvironment,
    encoding: 'utf8',
    input: options.input,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) {
    record(options.label ?? command, 'FAILED', startedAt);
    throw result.error;
  }
  if (result.status !== 0) {
    record(options.label ?? command, 'FAILED', startedAt);
    const detail = options.capture ? (result.stderr || result.stdout || '').trim() : '';
    throw new Error(
      `${options.label ?? command} exited ${result.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  record(options.label ?? command, 'PASSED', startedAt);
  return options.capture ? (result.stdout ?? '').trim() : '';
}

function compose(args, options = {}) {
  return execute('docker', [...composePrefix, ...args], options);
}

function tryCompose(args) {
  return spawnSync('docker', [...composePrefix, ...args], {
    cwd: process.cwd(),
    env: runtimeProcessEnvironment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function waitFor(label, args, timeoutMs = 120_000) {
  const startedAt = Date.now();
  let last = '';
  while (Date.now() - startedAt < timeoutMs) {
    const result = tryCompose(args);
    if (result.status === 0) {
      record(label, 'PASSED', startedAt);
      process.stdout.write(`[runtime] ${label}: ready\n`);
      return;
    }
    last = (result.stderr || result.stdout || '').trim().slice(-500);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
  }
  record(label, 'FAILED', startedAt);
  throw new Error(`${label} did not reach the expected state${last ? `: ${last}` : ''}`);
}

function serviceHttpCheck(service, url, expectedStatus) {
  const source = `fetch(${JSON.stringify(url)}).then(r=>{if(r.status!==${expectedStatus})throw new Error('status '+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})`;
  return ['exec', '-T', service, 'node', '-e', source];
}

function cleanup() {
  if (keepStack) {
    process.stdout.write('[runtime] KEEP_RUNTIME_STACK=true; isolated stack left running\n');
    return;
  }
  const result = tryCompose(['down', '--volumes', '--remove-orphans']);
  if (result.status !== 0)
    process.stderr.write(
      `[runtime] cleanup warning: ${(result.stderr || result.stdout || '').trim()}\n`,
    );
}

function captureFailureDiagnostics() {
  const status = tryCompose(['ps', '--all']);
  const applicationLogs = tryCompose([
    'logs',
    '--no-color',
    '--tail',
    '200',
    'api',
    'admin-web',
    'nginx',
    'worker',
  ]);
  const diagnostics = {
    composeStatus: redactDiagnostics(`${status.stdout ?? ''}${status.stderr ?? ''}`).slice(-8_000),
    applicationLogs: redactDiagnostics(
      `${applicationLogs.stdout ?? ''}${applicationLogs.stderr ?? ''}`,
    ).slice(-32_000),
  };
  process.stderr.write(
    `\n[runtime] failure diagnostics\n${JSON.stringify(diagnostics, null, 2)}\n`,
  );
  return diagnostics;
}

mkdirSync(reportDirectory, { recursive: true });
mkdirSync(browserResultsDirectory, { recursive: true });

try {
  execute('docker', ['version'], { label: 'Docker engine preflight' });
  compose(['config', '--quiet'], { label: 'Compose configuration validation' });
  tryCompose(['down', '--volumes', '--remove-orphans']);

  compose(
    [
      'up',
      '-d',
      '--build',
      'postgres',
      'redis',
      'minio',
      'minio-init',
      'clamav',
      'telegram-stub',
      'migrate',
    ],
    { label: 'Build and start isolated runtime dependencies' },
  );
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'db:seed'], {
    label: 'Development seed pass 1',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'db:seed'], {
    label: 'Development seed pass 2 (idempotency)',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'test:integration:required'], {
    label: 'Required PostgreSQL/Redis integration suite',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'test:e2e:required'], {
    label: 'Required API end-to-end suite',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'test:runtime:required'], {
    label: 'Required S3/ClamAV/LibreOffice runtime suite',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'db:seed'], {
    label: 'Refresh synthetic staff scopes after acceptance fixtures',
  });

  compose(['up', '-d', 'api', 'bot', 'worker', 'admin-web', 'nginx'], {
    label: 'Start complete application stack with acceptance fixtures',
  });
  waitFor('API readiness', serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 200));
  waitFor('Bot readiness', serviceHttpCheck('bot', 'http://127.0.0.1:3002/health/ready', 200));
  waitFor(
    'Worker readiness',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 200),
    180_000,
  );
  waitFor(
    'Admin through reverse proxy',
    ['exec', '-T', 'nginx', 'wget', '--spider', '--quiet', 'http://127.0.0.1:8080/'],
    180_000,
  );
  compose(['build', 'browser-tests'], { label: 'Build isolated Playwright Chromium runner' });
  compose(['run', '--rm', '--no-deps', 'browser-tests'], {
    label: 'Browser login, session persistence, protected navigation, and logout test',
  });
  compose(
    [
      'run',
      '--rm',
      '--no-deps',
      'runtime-tests',
      'node',
      'tests/fixtures/gateway-runtime-probe.mjs',
    ],
    { label: 'Reverse proxy API, OpenAPI, admin, and webhook-boundary smoke suite' },
  );
  compose(
    [
      'run',
      '--rm',
      '--no-deps',
      'runtime-tests',
      'node',
      'tests/fixtures/telegram-runtime-probe.mjs',
    ],
    {
      label: 'Telegram webhook, invalid update, and duplicate-update smoke suite',
    },
  );
  compose(
    ['run', '--rm', '--no-deps', 'runtime-tests', 'node', 'tests/fixtures/admin-runtime-probe.mjs'],
    { label: 'Admin authentication, RBAC API, and rendered-page smoke suite' },
  );
  const applicationLogs = compose(['logs', '--no-color', '--tail', '200', 'api', 'bot', 'worker'], {
    label: 'Capture structured application logs',
    capture: true,
  });
  for (const forbidden of [
    'Test-only-admin-password-2026!',
    'test-only-webhook-secret-32-characters',
    'test-only-service-secret-32-characters',
  ]) {
    if (applicationLogs.includes(forbidden))
      throw new Error('Application logs exposed a configured test secret');
  }
  compose(['stop', 'nginx', 'admin-web', 'bot', 'worker', 'api'], {
    label: 'Stop application services before independent recovery drill',
  });

  compose(['exec', '-T', 'postgres', 'dropdb', '--force', '-U', 'hmqa_test', 'hmqa_test'], {
    label: 'Reset PostgreSQL for independent recovery fixture',
  });
  compose(['exec', '-T', 'postgres', 'createdb', '-U', 'hmqa_test', 'hmqa_test'], {
    label: 'Create empty recovery-source database',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'db:migrate'], {
    label: 'Repeat all migrations from zero',
  });
  compose(['run', '--rm', 'runtime-tests', 'pnpm', 'db:seed'], {
    label: 'Seed clean recovery-source database',
  });
  compose(
    [
      'run',
      '--rm',
      'runtime-tests',
      'node',
      'apps/worker/test-fixtures/create-backup-evidence.mjs',
    ],
    { label: 'Create checksum-addressed backup evidence object and DB metadata' },
  );
  compose(
    [
      'run',
      '--rm',
      'runtime-tests',
      'node',
      'apps/worker/test-fixtures/verify-storage-consistency.mjs',
    ],
    { label: 'Verify source DB-to-object consistency' },
  );
  const sourceJournalCount = compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'hmqa_test',
      '-d',
      'hmqa_test',
      '-Atc',
      'SELECT count(*) FROM journals;',
    ],
    { label: 'Capture source database row count', capture: true },
  );
  compose(['--profile', 'backup', 'run', '--rm', 'backup'], {
    label: 'Encrypted PostgreSQL and object backup',
  });
  compose(['up', '-d', 'postgres-recovery', 'minio-recovery', 'minio-recovery-init'], {
    label: 'Start isolated recovery targets',
  });
  compose(
    [
      '--profile',
      'backup',
      'run',
      '--rm',
      '--no-deps',
      '-e',
      'PGHOST=postgres-recovery',
      '-e',
      'PGPORT=5432',
      '-e',
      'PGDATABASE=hmqa_recovery',
      '-e',
      'PGUSER=hmqa_recovery',
      '-e',
      'PGPASSWORD=test-only-recovery-password',
      '-e',
      'SOURCE_S3_ENDPOINT=http://minio-recovery:9000',
      '-e',
      'SOURCE_S3_ACCESS_KEY=hmqa-test-access',
      '-e',
      'SOURCE_S3_SECRET_KEY=test-only-minio-secret-key',
      '-e',
      'SOURCE_S3_BUCKET=hmqa-test-recovery',
      '-e',
      'RESTORE_SNAPSHOT=latest',
      '-e',
      'CONFIRM_RESTORE=HMQA_RESTORE',
      '--entrypoint',
      '/usr/local/bin/hmqa-restore',
      'backup',
    ],
    { label: 'Checksum-verified isolated restore' },
  );
  const restoredJournalCount = compose(
    [
      'exec',
      '-T',
      'postgres-recovery',
      'psql',
      '-U',
      'hmqa_recovery',
      '-d',
      'hmqa_recovery',
      '-Atc',
      'SELECT count(*) FROM journals;',
    ],
    { label: 'Capture restored database row count', capture: true },
  );
  if (sourceJournalCount !== restoredJournalCount)
    throw new Error(
      `Restore row-count mismatch: source=${sourceJournalCount}, restored=${restoredJournalCount}`,
    );
  compose(
    [
      'run',
      '--rm',
      '--no-deps',
      '-e',
      'DATABASE_URL=postgresql://hmqa_recovery:test-only-recovery-password@postgres-recovery:5432/hmqa_recovery?schema=public',
      '-e',
      'S3_ENDPOINT=http://minio-recovery:9000',
      '-e',
      'S3_BUCKET=hmqa-test-recovery',
      '-e',
      'S3_QUARANTINE_BUCKET=hmqa-test-recovery-quarantine',
      '-e',
      'REQUIRE_S3_SHA256_METADATA=false',
      'runtime-tests',
      'node',
      'apps/worker/test-fixtures/verify-storage-consistency.mjs',
    ],
    { label: 'Verify restored DB-to-object checksum consistency' },
  );
  compose(['up', '-d', 'api-recovery'], { label: 'Start API against restored targets' });
  waitFor(
    'Restored API readiness',
    serviceHttpCheck('api-recovery', 'http://127.0.0.1:3101/health/ready', 200),
  );
  compose(
    [
      'exec',
      '-T',
      'api-recovery',
      'node',
      '-e',
      "fetch('http://127.0.0.1:3101/api/v1/catalog/journals?locale=en').then(async r=>{const b=await r.json();if(r.status!==200||!Array.isArray(b.items)||b.items.length===0)throw new Error('restored catalog smoke failed')}).catch(e=>{console.error(e.message);process.exit(1)})",
    ],
    { label: 'Restored database application smoke test' },
  );

  compose(['up', '-d', 'api', 'bot', 'worker', 'admin-web', 'nginx'], {
    label: 'Restart complete application stack after recovery drill',
  });
  waitFor('API readiness', serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 200));
  waitFor('Bot readiness', serviceHttpCheck('bot', 'http://127.0.0.1:3002/health/ready', 200));
  waitFor(
    'Worker readiness',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 200),
    180_000,
  );
  waitFor(
    'Admin through reverse proxy after recovery drill',
    ['exec', '-T', 'nginx', 'wget', '--spider', '--quiet', 'http://127.0.0.1:8080/'],
    180_000,
  );

  compose(['stop', 'redis'], { label: 'Inject Redis outage' });
  waitFor(
    'API fails readiness while Redis is unavailable',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 503),
  );
  compose(['start', 'redis'], { label: 'Recover Redis' });
  waitFor(
    'API recovers after Redis restart',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 200),
  );

  compose(['stop', 'postgres'], { label: 'Inject PostgreSQL outage' });
  waitFor(
    'API fails readiness while PostgreSQL is unavailable',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 503),
  );
  compose(['start', 'postgres'], { label: 'Recover PostgreSQL' });
  waitFor(
    'API recovers after PostgreSQL restart',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 200),
  );

  compose(['stop', 'minio'], { label: 'Inject object-storage outage' });
  waitFor(
    'API fails readiness while storage is unavailable',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 503),
  );
  waitFor(
    'Worker fails readiness while storage is unavailable',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 503),
  );
  compose(['start', 'minio'], { label: 'Recover object storage' });
  waitFor(
    'API recovers after storage restart',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 200),
    180_000,
  );
  waitFor(
    'Worker recovers after storage restart',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 200),
    180_000,
  );

  compose(['stop', 'clamav'], { label: 'Inject antivirus outage' });
  waitFor(
    'Worker fails readiness while antivirus is unavailable',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 503),
  );
  compose(['start', 'clamav'], { label: 'Recover antivirus' });
  waitFor(
    'Worker recovers after antivirus restart',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 200),
    180_000,
  );
  compose(['restart', 'worker'], { label: 'Restart worker service' });
  waitFor(
    'Worker is ready after graceful restart',
    serviceHttpCheck('worker', 'http://127.0.0.1:3003/health/ready', 200),
    180_000,
  );
  compose(['restart', 'api'], { label: 'Restart API service' });
  waitFor(
    'API is ready after graceful restart',
    serviceHttpCheck('api', 'http://127.0.0.1:3001/health/ready', 200),
  );
  const postFailureJournalCount = compose(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'hmqa_test',
      '-d',
      'hmqa_test',
      '-Atc',
      'SELECT count(*) FROM journals;',
    ],
    { label: 'Capture post-failure database row count', capture: true },
  );
  if (postFailureJournalCount !== sourceJournalCount)
    throw new Error(
      `Failure-injection row-count mismatch: before=${sourceJournalCount}, after=${postFailureJournalCount}`,
    );
  compose(
    [
      'run',
      '--rm',
      'runtime-tests',
      'node',
      'apps/worker/test-fixtures/verify-storage-consistency.mjs',
    ],
    { label: 'Verify source DB-to-object consistency after failure injection' },
  );

  evidence.outcome = 'PASSED';
} catch (error) {
  evidence.outcome = 'FAILED';
  evidence.blocker = error instanceof Error ? error.message : String(error);
  evidence.diagnostics = captureFailureDiagnostics();
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  cleanup();
  writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`\n[runtime] evidence: ${reportPath}\n`);
  process.stdout.write(`[runtime] outcome: ${evidence.outcome}\n`);
  if (evidence.blocker) process.stderr.write(`[runtime] blocker: ${evidence.blocker}\n`);
}
