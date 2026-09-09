import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { generateReceiptPdf } from './receipt-generator.js';

describe('localized receipt PDF', () => {
  it('creates a parseable PDF from an immutable receipt snapshot', async () => {
    const bytes = await generateReceiptPdf(
      {
        publicId: 'HMQA-LAW-2026-000001',
        status: 'SUBMITTED',
        submittedAt: '2026-09-09T08:00:00.000Z',
        journalCode: 'LAW',
        submissionVersion: 1,
        requirementsVersion: 3,
        files: [
          {
            categoryLabel: 'Main manuscript',
            originalName: 'article.docx',
            sha256: 'a'.repeat(64),
            sizeBytes: '1024',
          },
        ],
      },
      'en',
      'Asia/Tashkent',
    );
    expect(Buffer.from(bytes).subarray(0, 5).toString('ascii')).toBe('%PDF-');
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(parsed.getTitle()).toContain('HMQA-LAW-2026-000001');
  });
});
