import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', '.next', '.codex-temp', 'coverage', 'dist', 'node_modules']);
const readable = new Set([
  '.env',
  '.example',
  '.json',
  '.js',
  '.mjs',
  '.ts',
  '.tsx',
  '.yml',
  '.yaml',
]);
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /TELEGRAM_BOT_TOKEN\s*=\s*\d{6,}:[A-Za-z0-9_-]{20,}/,
];
const findings = [];

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (stat.size > 2_000_000 || !readable.has(extname(path))) continue;
    const content = readFileSync(path, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(content)) findings.push(`${relative(root, path)} matched ${pattern.source}`);
    }
  }
}

walk(root);
if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exit(1);
}
