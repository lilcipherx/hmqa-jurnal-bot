import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectUpload } from './file-validator.js';

describe('upload file validation', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('accepts a passive PDF with a valid signature and trailer', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hmqa-pdf-'));
    const path = join(directory, 'review.pdf');
    await writeFile(path, '%PDF-1.7\n1 0 obj\n<<>>\nendobj\nstartxref\n0\n%%EOF\n');
    await expect(inspectUpload(path, 'pdf')).resolves.toMatchObject({
      detectedMime: 'application/pdf',
      format: 'pdf',
    });
  });

  it('rejects active PDF content', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hmqa-pdf-'));
    const path = join(directory, 'active.pdf');
    await writeFile(path, '%PDF-1.7\n/OpenAction 1 0 R\n%%EOF\n');
    await expect(inspectUpload(path, 'pdf')).rejects.toThrow('PDF_ACTIVE_CONTENT_NOT_ALLOWED');
  });

  it('rejects a format mismatch', async () => {
    directory = await mkdtemp(join(tmpdir(), 'hmqa-file-'));
    const path = join(directory, 'spoof.pdf');
    await writeFile(path, 'not a document');
    await expect(inspectUpload(path, 'pdf')).rejects.toThrow('SIGNATURE_NOT_PDF');
  });
});
