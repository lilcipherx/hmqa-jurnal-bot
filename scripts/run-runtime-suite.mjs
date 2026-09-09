import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const suite = process.argv[2];
const configs = {
  integration: 'vitest.integration.config.ts',
  e2e: 'vitest.e2e.config.ts',
  runtime: 'vitest.runtime.config.ts',
};
const config = configs[suite];
if (!config) {
  throw new Error('Expected runtime suite: integration, e2e, or runtime');
}
const requiredVariables =
  suite === 'runtime'
    ? [
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
      ]
    : ['DATABASE_URL', 'REDIS_URL'];
const missingRuntime = requiredVariables.filter((name) => !process.env[name]?.trim());
if (missingRuntime.length > 0) {
  throw new Error(`${suite} requires runtime variables: ${missingRuntime.join(', ')}`);
}

const reportDirectory = resolve('.codex-temp', 'test-reports');
const reportPath = resolve(reportDirectory, `${suite}.json`);
mkdirSync(reportDirectory, { recursive: true });

const pnpmEntry = process.env.npm_execpath;
if (!pnpmEntry) {
  throw new Error('Run this command through pnpm so npm_execpath is available');
}
const result = spawnSync(
  process.execPath,
  [
    pnpmEntry,
    'exec',
    'vitest',
    'run',
    '--config',
    config,
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${reportPath}`,
  ],
  {
    env: { ...process.env, REQUIRE_RUNTIME_TESTS: 'true' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
if (result.status !== 0) {
  try {
    const failedReport = JSON.parse(readFileSync(reportPath, 'utf8'));
    const diagnostics = {
      success: failedReport.success,
      numTotalTests: failedReport.numTotalTests,
      numPassedTests: failedReport.numPassedTests,
      numFailedTests: failedReport.numFailedTests,
      numPendingTests: failedReport.numPendingTests,
      testExecError: failedReport.testExecError,
      unhandledErrors: failedReport.unhandledErrors,
      files: (failedReport.testResults ?? []).map((testFile) => ({
        name: testFile.name,
        status: testFile.status,
        message: testFile.message,
        failedAssertions: (testFile.assertionResults ?? [])
          .filter((assertion) => assertion.status === 'failed')
          .map((assertion) => ({
            name: assertion.fullName ?? assertion.title,
            failureMessages: assertion.failureMessages,
          })),
      })),
    };
    process.stderr.write(
      `VITEST_FAILURE_DIAGNOSTICS ${JSON.stringify(diagnostics).slice(0, 16_000)}\n`,
    );
    for (const testFile of failedReport.testResults ?? []) {
      if (testFile.status !== 'failed') continue;
      process.stderr.write(`FAILED ${testFile.name ?? 'unknown test file'}\n`);
      if (testFile.message) process.stderr.write(`${String(testFile.message).slice(0, 8_000)}\n`);
      for (const assertion of testFile.assertionResults ?? []) {
        if (assertion.status !== 'failed') continue;
        process.stderr.write(`  ${assertion.fullName ?? assertion.title ?? 'unknown assertion'}\n`);
        for (const message of assertion.failureMessages ?? []) {
          process.stderr.write(`${String(message).slice(0, 4_000)}\n`);
        }
      }
    }
  } catch (reportError) {
    process.stderr.write(
      `Unable to read failed ${suite} report: ${reportError instanceof Error ? reportError.message : String(reportError)}\n`,
    );
  }
  process.exit(result.status ?? 1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const skippedAssertions = (report.testResults ?? []).flatMap((testFile) =>
  (testFile.assertionResults ?? []).filter((assertion) =>
    ['pending', 'skipped', 'todo', 'disabled'].includes(assertion.status),
  ),
);
const skippedCount = Math.max(report.numPendingTests ?? 0, skippedAssertions.length);
if (skippedCount > 0) {
  throw new Error(`${suite} suite contained ${skippedCount} skipped test(s)`);
}
if ((report.numTotalTests ?? 0) === 0) {
  throw new Error(`${suite} suite executed zero tests`);
}

process.stdout.write(
  `${suite}: ${report.numPassedTests}/${report.numTotalTests} passed, 0 skipped\n`,
);
