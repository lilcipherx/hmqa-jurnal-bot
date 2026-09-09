import { readFile } from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { inspectDocx } from './docx-validator.js';

export interface FileInspection {
  readonly detectedMime: string;
  readonly format: 'docx' | 'pdf';
}

async function inspectPdf(path: string): Promise<FileInspection> {
  const [type, bytes] = await Promise.all([fileTypeFromFile(path), readFile(path)]);
  if (type?.ext !== 'pdf' || type.mime !== 'application/pdf') throw new Error('SIGNATURE_NOT_PDF');
  const header = bytes.subarray(0, 16).toString('latin1');
  const trailer = bytes.subarray(Math.max(0, bytes.length - 4096)).toString('latin1');
  if (!/^%PDF-1\.[0-9]/.test(header) || !trailer.includes('%%EOF'))
    throw new Error('PDF_STRUCTURE_INVALID');
  const source = bytes.toString('latin1');
  if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/i.test(source))
    throw new Error('PDF_ACTIVE_CONTENT_NOT_ALLOWED');
  return { detectedMime: type.mime, format: 'pdf' };
}

export async function inspectUpload(path: string, expectedExtension: string | null) {
  if (expectedExtension === 'docx') {
    const inspection = await inspectDocx(path);
    return { detectedMime: inspection.detectedMime, format: 'docx' as const };
  }
  if (expectedExtension === 'pdf') return inspectPdf(path);
  throw new Error('FILE_FORMAT_NOT_SUPPORTED');
}
