import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectDocx } from './docx-validator.js';

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

describe('DOCX inspection', () => {
  it('rejects extension-only spoofing', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hmqa-docx-'));
    const file = join(directory, 'spoof.docx');
    await writeFile(file, 'not a zip or a Word document', { mode: 0o600 });
    await expect(inspectDocx(file)).rejects.toThrow('SIGNATURE_NOT_DOCX');
  });
});
