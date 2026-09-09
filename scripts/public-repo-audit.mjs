import { execFileSync, spawnSync } from 'node:child_process';
import { basename, extname } from 'node:path';

const root = process.cwd();
const allowedEnvironmentExamples = new Set(['.env.example', '.env.test.example']);
const forbiddenExtensions = new Set([
  '.backup',
  '.dump',
  '.jks',
  '.key',
  '.keystore',
  '.log',
  '.p12',
  '.pfx',
  '.pem',
]);
const forbiddenPathParts = new Set([
  '.secrets',
  'backups',
  'debug-dumps',
  'private-keys',
  'secrets',
]);
const secretPatterns = [
  ['private key', /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Google API key', /\bAIza[A-Za-z0-9_-]{30,}\b/],
  ['OpenAI API key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{16,}\b/],
  ['Telegram bot token', /\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/],
];
const reservedEmailDomains = new Set(['example.com', 'example.invalid', 'example.test']);
const explicitlySyntheticPhones = new Set([
  '+998000000000',
  '+998901234567',
  '+999000000000',
  '+999000000001',
]);
const findings = [];

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function auditPath(path, source) {
  const normalized = path.replaceAll('\\', '/');
  const name = basename(normalized);
  const parts = normalized.toLowerCase().split('/');
  if (name.startsWith('.env') && !allowedEnvironmentExamples.has(name)) {
    findings.push(`${source}: forbidden environment file path ${normalized}`);
  }
  if (forbiddenExtensions.has(extname(name).toLowerCase())) {
    findings.push(`${source}: forbidden sensitive/archive extension ${normalized}`);
  }
  if (parts.some((part) => forbiddenPathParts.has(part))) {
    findings.push(`${source}: forbidden sensitive directory ${normalized}`);
  }
}

function auditText(content, source) {
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) findings.push(`${source}: matched ${label}`);
  }

  const emails = content.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi);
  for (const match of emails) {
    const domain = match[1]?.toLowerCase();
    if (domain && !reservedEmailDomains.has(domain) && !domain.endsWith('.internal')) {
      findings.push(`${source}: non-reserved email domain ${domain}`);
    }
  }

  const phoneNumbers = content.matchAll(/\+[1-9]\d{8,14}\b/g);
  for (const match of phoneNumbers) {
    if (!explicitlySyntheticPhones.has(match[0])) {
      findings.push(`${source}: plausible public phone number`);
    }
  }
}

const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
for (const path of tracked) auditPath(path, 'tracked');

const objectLines = git(['rev-list', '--objects', '--all']).split(/\r?\n/).filter(Boolean);
const objectIds = [...new Set(objectLines.map((line) => line.split(' ', 1)[0]))];
for (const line of objectLines) {
  const separator = line.indexOf(' ');
  const path = separator === -1 ? '' : line.slice(separator + 1);
  if (path) auditPath(path, 'history');
}

const objectTypes = spawnSync('git', ['cat-file', '--batch-check=%(objecttype)'], {
  cwd: root,
  input: `${objectIds.join('\n')}\n`,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (objectTypes.status !== 0) throw new Error(objectTypes.stderr || 'git cat-file failed');
const auditedBlobCount = objectTypes.stdout.split(/\r?\n/).filter((type) => type === 'blob').length;

const commits = git(['rev-list', '--all']).split(/\r?\n/).filter(Boolean);
const historyText = spawnSync('git', ['grep', '-I', '-n', '-e', '.', ...commits], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (historyText.status !== 0 && historyText.status !== 1) {
  throw new Error(historyText.stderr || 'git grep history scan failed');
}
auditText(historyText.stdout, 'reachable history');

if (findings.length > 0) {
  console.error([...new Set(findings)].join('\n'));
  process.exit(1);
}

process.stdout.write(
  `Public repository audit passed: ${tracked.length} tracked paths and ${auditedBlobCount} reachable blobs checked.\n`,
);
