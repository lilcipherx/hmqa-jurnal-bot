import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DocxPreflightPolicy, PreflightSeverity } from '@hmqa/contracts';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { PDFDocument } from 'pdf-lib';
import { readDocxXmlPart } from './docx-validator.js';

type XmlObject = Record<string, unknown>;

export interface DocxSectionMetrics {
  readonly widthMm?: number;
  readonly heightMm?: number;
  readonly leftMm?: number;
  readonly rightMm?: number;
  readonly topMm?: number;
  readonly bottomMm?: number;
}

export interface DocxModel {
  readonly sections: readonly DocxSectionMetrics[];
  readonly defaultFontFamily?: string;
  readonly defaultFontSizePt?: number;
  readonly defaultLineSpacing?: number;
  readonly plainText: string;
  readonly paragraphCount: number;
}

export interface PreflightFinding {
  readonly code: string;
  readonly severity: PreflightSeverity;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly section?: number;
}

export interface DocxPreflightResult {
  readonly findings: readonly PreflightFinding[];
  readonly blockingCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly statistics: {
    readonly paragraphCount: number;
    readonly sectionCount: number;
    readonly renderedPageCount: number | null;
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  isArray: (tagName) => ['p', 'r', 't', 'sectPr', 'style'].includes(tagName),
});

function record(value: unknown): XmlObject | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as XmlObject)
    : undefined;
}

function firstRecord(value: unknown): XmlObject | undefined {
  if (Array.isArray(value)) return record(value[0]);
  return record(value);
}

function collectNodes(value: unknown, key: string, result: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, key, result);
    return result;
  }
  const object = record(value);
  if (!object) return result;
  for (const [name, child] of Object.entries(object)) {
    if (name === key) {
      if (Array.isArray(child)) {
        for (const item of child as unknown[]) result.push(item);
      } else result.push(child);
    } else collectNodes(child, key, result);
  }
  return result;
}

function numericAttribute(value: unknown, name: string): number | undefined {
  const raw = record(value)?.[name];
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function twipsToMillimetres(value: number | undefined): number | undefined {
  return value === undefined ? undefined : (value * 25.4) / 1440;
}

function textNode(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textNode).join('');
  const object = record(value);
  return typeof object?.['#text'] === 'string' ? object['#text'] : '';
}

function assertXml(xml: string, part: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error(`DOCX_XML_DTD_NOT_ALLOWED:${part}`);
  if (XMLValidator.validate(xml) !== true) throw new Error(`DOCX_XML_INVALID:${part}`);
}

export function parseDocxModel(documentXml: string, stylesXml: string | null): DocxModel {
  assertXml(documentXml, 'document');
  if (stylesXml) assertXml(stylesXml, 'styles');
  const document = parser.parse(documentXml) as unknown;
  const styles = stylesXml ? (parser.parse(stylesXml) as unknown) : null;
  const sections = collectNodes(document, 'sectPr').flatMap((node): DocxSectionMetrics[] => {
    const section = record(node);
    if (!section) return [];
    const page = firstRecord(section.pgSz);
    const margins = firstRecord(section.pgMar);
    const widthMm = twipsToMillimetres(numericAttribute(page, 'w'));
    const heightMm = twipsToMillimetres(numericAttribute(page, 'h'));
    const leftMm = twipsToMillimetres(numericAttribute(margins, 'left'));
    const rightMm = twipsToMillimetres(numericAttribute(margins, 'right'));
    const topMm = twipsToMillimetres(numericAttribute(margins, 'top'));
    const bottomMm = twipsToMillimetres(numericAttribute(margins, 'bottom'));
    return [
      {
        ...(widthMm !== undefined ? { widthMm } : {}),
        ...(heightMm !== undefined ? { heightMm } : {}),
        ...(leftMm !== undefined ? { leftMm } : {}),
        ...(rightMm !== undefined ? { rightMm } : {}),
        ...(topMm !== undefined ? { topMm } : {}),
        ...(bottomMm !== undefined ? { bottomMm } : {}),
      },
    ];
  });
  const styleNodes = collectNodes(styles, 'style').flatMap((node) => {
    const item = record(node);
    return item ? [item] : [];
  });
  const paragraphStyle =
    styleNodes.find((style) => style.type === 'paragraph' && style.default === '1') ??
    styleNodes.find((style) => style.styleId === 'Normal');
  const styleRoot = firstRecord(record(styles)?.styles);
  const documentDefaults = firstRecord(
    firstRecord(firstRecord(styleRoot?.docDefaults)?.rPrDefault)?.rPr,
  );
  const styleRun = firstRecord(paragraphStyle?.rPr);
  const runProperties = styleRun ?? documentDefaults;
  const fonts = firstRecord(runProperties?.rFonts);
  const sizeHalfPoints = numericAttribute(firstRecord(runProperties?.sz), 'val');
  const spacing = firstRecord(firstRecord(paragraphStyle?.pPr)?.spacing);
  const lineTwips = numericAttribute(spacing, 'line');
  const lineRule = record(spacing)?.lineRule;
  const text = collectNodes(document, 't').map(textNode).join(' ');
  const defaultFontFamily =
    typeof fonts?.ascii === 'string'
      ? fonts.ascii
      : typeof fonts?.hAnsi === 'string'
        ? fonts.hAnsi
        : undefined;
  const defaultFontSizePt = sizeHalfPoints === undefined ? undefined : sizeHalfPoints / 2;
  const defaultLineSpacing =
    lineTwips === undefined || (lineRule !== undefined && lineRule !== 'auto')
      ? undefined
      : lineTwips / 240;
  return {
    sections,
    ...(defaultFontFamily !== undefined ? { defaultFontFamily } : {}),
    ...(defaultFontSizePt !== undefined ? { defaultFontSizePt } : {}),
    ...(defaultLineSpacing !== undefined ? { defaultLineSpacing } : {}),
    plainText: text.replace(/\s+/g, ' ').trim(),
    paragraphCount: collectNodes(document, 'p').length,
  };
}

function closeEnough(actual: number | undefined, expected: number, tolerance: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) <= tolerance;
}

export function evaluateDocxPreflight(
  model: DocxModel,
  policy: DocxPreflightPolicy,
  renderedPageCount: number | null = null,
): DocxPreflightResult {
  const findings: PreflightFinding[] = [];
  const add = (finding: PreflightFinding) => findings.push(finding);
  if (policy.renderedPages) {
    if (renderedPageCount === null)
      add({ code: 'RENDERED_PAGE_COUNT_UNAVAILABLE', severity: policy.renderedPages.severity });
    else if (
      renderedPageCount < policy.renderedPages.min ||
      renderedPageCount > policy.renderedPages.max
    )
      add({
        code: 'RENDERED_PAGE_COUNT_OUT_OF_RANGE',
        severity: policy.renderedPages.severity,
        expected: { min: policy.renderedPages.min, max: policy.renderedPages.max },
        actual: renderedPageCount,
      });
  }
  if ((policy.page || policy.margins) && model.sections.length === 0)
    add({
      code: 'SECTION_FORMAT_UNAVAILABLE',
      severity: policy.page?.severity ?? policy.margins!.severity,
    });
  for (const [index, section] of model.sections.entries()) {
    if (
      policy.page &&
      (!closeEnough(section.widthMm, policy.page.widthMm, policy.page.toleranceMm) ||
        !closeEnough(section.heightMm, policy.page.heightMm, policy.page.toleranceMm))
    )
      add({
        code: 'PAGE_SIZE_MISMATCH',
        severity: policy.page.severity,
        expected: { widthMm: policy.page.widthMm, heightMm: policy.page.heightMm },
        actual: { widthMm: section.widthMm ?? null, heightMm: section.heightMm ?? null },
        section: index + 1,
      });
    if (
      policy.margins &&
      (!closeEnough(section.leftMm, policy.margins.leftMm, policy.margins.toleranceMm) ||
        !closeEnough(section.rightMm, policy.margins.rightMm, policy.margins.toleranceMm) ||
        !closeEnough(section.topMm, policy.margins.topMm, policy.margins.toleranceMm) ||
        !closeEnough(section.bottomMm, policy.margins.bottomMm, policy.margins.toleranceMm))
    )
      add({
        code: 'PAGE_MARGIN_MISMATCH',
        severity: policy.margins.severity,
        expected: {
          leftMm: policy.margins.leftMm,
          rightMm: policy.margins.rightMm,
          topMm: policy.margins.topMm,
          bottomMm: policy.margins.bottomMm,
        },
        actual: {
          leftMm: section.leftMm ?? null,
          rightMm: section.rightMm ?? null,
          topMm: section.topMm ?? null,
          bottomMm: section.bottomMm ?? null,
        },
        section: index + 1,
      });
  }
  if (policy.defaultFont) {
    if (!model.defaultFontFamily || model.defaultFontSizePt === undefined)
      add({ code: 'DEFAULT_FONT_UNAVAILABLE', severity: policy.defaultFont.severity });
    else if (
      model.defaultFontFamily.localeCompare(policy.defaultFont.family, undefined, {
        sensitivity: 'accent',
      }) !== 0 ||
      !closeEnough(
        model.defaultFontSizePt,
        policy.defaultFont.sizePt,
        policy.defaultFont.tolerancePt,
      )
    )
      add({
        code: 'DEFAULT_FONT_MISMATCH',
        severity: policy.defaultFont.severity,
        expected: { family: policy.defaultFont.family, sizePt: policy.defaultFont.sizePt },
        actual: { family: model.defaultFontFamily, sizePt: model.defaultFontSizePt },
      });
  }
  if (policy.lineSpacing) {
    if (model.defaultLineSpacing === undefined)
      add({ code: 'LINE_SPACING_UNAVAILABLE', severity: policy.lineSpacing.severity });
    else if (
      !closeEnough(
        model.defaultLineSpacing,
        policy.lineSpacing.multiple,
        policy.lineSpacing.tolerance,
      )
    )
      add({
        code: 'LINE_SPACING_MISMATCH',
        severity: policy.lineSpacing.severity,
        expected: policy.lineSpacing.multiple,
        actual: model.defaultLineSpacing,
      });
  }
  const normalizedText = model.plainText.toLocaleLowerCase('und');
  for (const marker of policy.requiredMarkers) {
    if (
      !marker.anyOf.some((candidate) => normalizedText.includes(candidate.toLocaleLowerCase('und')))
    )
      add({ code: marker.code, severity: marker.severity });
  }
  return {
    findings,
    blockingCount: findings.filter((finding) => finding.severity === 'BLOCKING').length,
    errorCount: findings.filter((finding) => finding.severity === 'ERROR').length,
    warningCount: findings.filter((finding) => finding.severity === 'WARNING').length,
    statistics: {
      paragraphCount: model.paragraphCount,
      sectionCount: model.sections.length,
      renderedPageCount,
    },
  };
}

function convertToPdf(
  executable: string,
  sourcePath: string,
  outputDirectory: string,
  timeoutMs: number,
): Promise<void> {
  const profileUrl = pathToFileURL(join(outputDirectory, 'libreoffice-profile')).href;
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [
        '--headless',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        '--nofirststartwizard',
        `-env:UserInstallation=${profileUrl}`,
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        outputDirectory,
        sourcePath,
      ],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1_048_576,
        env: {
          ...process.env,
          TMPDIR: outputDirectory,
          TEMP: outputDirectory,
          TMP: outputDirectory,
        },
      },
      (error) =>
        error ? reject(new Error('DOCX_RENDER_PROCESS_FAILED', { cause: error })) : resolve(),
    );
  });
}

export async function renderDocxPageCount(
  path: string,
  executable: string,
  timeoutMs: number,
): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'hmqa-docx-render-'));
  try {
    // Telegram quarantine objects deliberately have an opaque `.upload` suffix.
    // LibreOffice chooses its import filter from the extension, so render a
    // private copy with the validated DOCX extension inside the isolated job dir.
    const renderSource = join(directory, 'manuscript.docx');
    await copyFile(path, renderSource);
    await convertToPdf(executable, renderSource, directory, timeoutMs);
    const expectedName = `${basename(renderSource).replace(/\.[^.]+$/, '')}.pdf`;
    const files = await readdir(directory);
    const pdfName =
      files.find((name) => name === expectedName) ?? files.find((name) => /\.pdf$/i.test(name));
    if (!pdfName) throw new Error('DOCX_RENDER_OUTPUT_MISSING');
    const pdf = await PDFDocument.load(await readFile(join(directory, pdfName)));
    const count = pdf.getPageCount();
    if (count < 1 || count > 10_000) throw new Error('DOCX_RENDER_PAGE_COUNT_INVALID');
    return count;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runDocxPreflight(
  path: string,
  policy: DocxPreflightPolicy,
  renderer: { executable: string; timeoutMs: number },
): Promise<DocxPreflightResult> {
  const [documentXml, stylesXml] = await Promise.all([
    readDocxXmlPart(path, 'word/document.xml'),
    readDocxXmlPart(path, 'word/styles.xml'),
  ]);
  if (!documentXml) throw new Error('DOCX_DOCUMENT_XML_MISSING');
  const model = parseDocxModel(documentXml, stylesXml);
  const pageCount = policy.renderedPages
    ? await renderDocxPageCount(path, renderer.executable, renderer.timeoutMs).catch(() => null)
    : null;
  return evaluateDocxPreflight(model, policy, pageCount);
}
