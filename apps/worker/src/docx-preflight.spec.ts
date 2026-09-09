import { docxPreflightPolicySchema } from '@hmqa/contracts';
import { describe, expect, it } from 'vitest';
import { evaluateDocxPreflight, parseDocxModel } from './docx-preflight.js';

const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Article content</w:t></w:r></w:p>
    <w:p><w:r><w:t>Author information</w:t></w:r></w:p>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838" />
      <w:pgMar w:left="1701" w:right="850" w:top="1134" w:bottom="1134" />
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:pPr><w:spacing w:line="360" w:lineRule="auto" /></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" />
      <w:sz w:val="28" />
    </w:rPr>
  </w:style>
</w:styles>`;

const policy = docxPreflightPolicySchema.parse({
  rulesVersion: 'axborotnomasi-2026-1',
  renderedPages: { min: 8, max: 10, severity: 'ERROR' },
  page: { widthMm: 210, heightMm: 297, toleranceMm: 1, severity: 'ERROR' },
  margins: {
    leftMm: 30,
    rightMm: 15,
    topMm: 20,
    bottomMm: 20,
    toleranceMm: 1,
    severity: 'ERROR',
  },
  defaultFont: {
    family: 'Times New Roman',
    sizePt: 14,
    tolerancePt: 0.5,
    severity: 'WARNING',
  },
  lineSpacing: { multiple: 1.5, tolerance: 0.05, severity: 'WARNING' },
  requiredMarkers: [
    { code: 'AUTHOR_BLOCK_MISSING', anyOf: ['author information'], severity: 'BLOCKING' },
  ],
});

describe('DOCX configurable preflight', () => {
  it('extracts OOXML section and default-style measurements', () => {
    const model = parseDocxModel(documentXml, stylesXml);
    expect(model).toMatchObject({
      paragraphCount: 2,
      defaultFontFamily: 'Times New Roman',
      defaultFontSizePt: 14,
      defaultLineSpacing: 1.5,
    });
    expect(model.sections[0]).toMatchObject({
      widthMm: expect.closeTo(210, 0),
      heightMm: expect.closeTo(297, 0),
      leftMm: expect.closeTo(30, 0),
      rightMm: expect.closeTo(15, 0),
    });
    expect(evaluateDocxPreflight(model, policy, 9)).toMatchObject({
      findings: [],
      blockingCount: 0,
      errorCount: 0,
      warningCount: 0,
      statistics: { renderedPageCount: 9, sectionCount: 1 },
    });
  });

  it('reports configured severity without leaking manuscript text', () => {
    const model = parseDocxModel(documentXml.replace('Author information', 'End'), stylesXml);
    const result = evaluateDocxPreflight(model, policy, 12);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'RENDERED_PAGE_COUNT_OUT_OF_RANGE', severity: 'ERROR' }),
        expect.objectContaining({ code: 'AUTHOR_BLOCK_MISSING', severity: 'BLOCKING' }),
      ]),
    );
    expect(JSON.stringify(result.findings)).not.toContain('Article content');
    expect(result).toMatchObject({ blockingCount: 1, errorCount: 1 });
  });

  it('rejects DTD/entity declarations in OOXML parts', () => {
    expect(() =>
      parseDocxModel('<!DOCTYPE x [<!ENTITY y "bad">]><document><body /></document>', null),
    ).toThrow('DOCX_XML_DTD_NOT_ALLOWED');
  });
});
