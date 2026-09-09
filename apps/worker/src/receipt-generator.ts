import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { translate, type Locale } from '@hmqa/i18n';
import { z } from 'zod';

export const receiptSnapshotSchema = z.object({
  publicId: z.string().min(1).max(64),
  status: z.string().min(1).max(64),
  submittedAt: z.iso.datetime(),
  journalCode: z.string().min(1).max(32),
  submissionVersion: z.number().int().positive(),
  requirementsVersion: z.number().int().positive(),
  files: z
    .array(
      z.object({
        categoryLabel: z.string().min(1).max(300),
        originalName: z.string().min(1).max(500),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        sizeBytes: z.string().regex(/^\d+$/),
      }),
    )
    .min(1)
    .max(50),
});

export type ReceiptSnapshot = z.infer<typeof receiptSnapshotSchema>;

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = '';
    for (const character of word) {
      const extended = fragment + character;
      if (font.widthOfTextAtSize(extended, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = extended;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

export async function generateReceiptPdf(
  rawSnapshot: unknown,
  locale: Locale,
  timeZone: string,
  fontBytes?: Uint8Array,
): Promise<Uint8Array> {
  const snapshot = receiptSnapshotSchema.parse(rawSnapshot);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${translate(locale, 'receipt.title')} ${snapshot.publicId}`);
  pdf.setAuthor('HMQA JURNAL BOT');
  pdf.setSubject(translate(locale, 'receipt.subject'));
  pdf.setCreator('HMQA JURNAL BOT receipt-v1');
  pdf.setProducer('HMQA JURNAL BOT');
  pdf.setCreationDate(new Date(snapshot.submittedAt));
  let font: PDFFont;
  if (fontBytes) {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(fontBytes, { subset: true });
  } else {
    font = await pdf.embedFont(StandardFonts.Helvetica);
  }

  const pageSize: [number, number] = [595.28, 841.89];
  const margin = 52;
  const bodySize = 10;
  const lineHeight = 15;
  let page: PDFPage = pdf.addPage(pageSize);
  let y = page.getHeight() - margin;
  const addPage = () => {
    page = pdf.addPage(pageSize);
    y = page.getHeight() - margin;
  };
  const write = (
    text: string,
    options: { size?: number; gapAfter?: number; color?: ReturnType<typeof rgb> } = {},
  ) => {
    const size = options.size ?? bodySize;
    const lines = wrapText(text, font, size, page.getWidth() - margin * 2);
    for (const line of lines) {
      if (y < margin + lineHeight) addPage();
      page.drawText(line, {
        x: margin,
        y,
        size,
        font,
        color: options.color ?? rgb(0.12, 0.15, 0.2),
      });
      y -= size + 5;
    }
    y -= options.gapAfter ?? 4;
  };

  write(translate(locale, 'receipt.title'), {
    size: 18,
    gapAfter: 14,
    color: rgb(0.05, 0.3, 0.55),
  });
  const submittedAt = new Date(snapshot.submittedAt);
  const localDate = new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'long',
    timeZone,
  }).format(submittedAt);
  const utcDate = submittedAt.toISOString();
  const status = translate(locale, `status.${snapshot.status.toLowerCase()}` as never);
  const rows = [
    translate(locale, 'receipt.public_id', { value: snapshot.publicId }),
    translate(locale, 'receipt.status', { value: status }),
    translate(locale, 'receipt.submitted_at_local', { value: localDate, timezone: timeZone }),
    translate(locale, 'receipt.submitted_at_utc', { value: utcDate }),
    translate(locale, 'receipt.journal', { value: snapshot.journalCode }),
    translate(locale, 'receipt.submission_version', { value: String(snapshot.submissionVersion) }),
    translate(locale, 'receipt.requirements_version', {
      value: String(snapshot.requirementsVersion),
    }),
  ];
  for (const row of rows) write(row);

  y -= 4;
  write(translate(locale, 'receipt.files'), {
    size: 13,
    gapAfter: 7,
    color: rgb(0.05, 0.3, 0.55),
  });
  for (const [index, file] of snapshot.files.entries()) {
    const size = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(
      Number(file.sizeBytes),
    );
    write(
      translate(locale, 'receipt.file_item', {
        number: String(index + 1),
        category: file.categoryLabel,
        filename: file.originalName,
        size,
        sha256: file.sha256,
      }),
      { gapAfter: 7 },
    );
  }
  y -= 4;
  write(translate(locale, 'receipt.next_step'), {
    size: 13,
    color: rgb(0.05, 0.3, 0.55),
  });
  write(translate(locale, 'receipt.next_step_text'), { gapAfter: 12 });
  write(translate(locale, 'receipt.disclaimer'), { color: rgb(0.5, 0.12, 0.12) });

  return pdf.save({ useObjectStreams: true });
}
