import { describe, expect, it } from 'vitest';
import { journalRequirementConfigSchema, orcidSchema } from './index.js';

const manuscript = {
  category: 'MANUSCRIPT',
  labels: { 'uz-Latn': 'Asosiy maqola', ru: 'Основная статья', en: 'Main manuscript' },
  formats: ['docx'] as const,
  required: true,
};

describe('journal requirement file contract', () => {
  it('accepts a localized, bounded DOCX/PDF file set', () => {
    const result = journalRequirementConfigSchema.parse({
      requiredFiles: [
        manuscript,
        {
          category: 'REVIEW_LETTER',
          labels: { 'uz-Latn': 'Taqriz', ru: 'Рецензия', en: 'Review letter' },
          formats: ['docx', 'pdf'],
          required: false,
        },
      ],
      limits: { maxBytes: 19 * 1024 * 1024, maxFiles: 5, maxTotalBytes: 40 * 1024 * 1024 },
      preflight: { docx: { rulesVersion: 'test-v1' } },
    });
    expect(result.requiredFiles[0]?.preflightRequired).toBe(true);
    expect(result.workflow).toEqual({
      reviewModel: 'NO_EXTERNAL_REVIEW',
      requiredReviewerCount: 0,
      decisionRequiresCompletedReviews: false,
    });
    expect(result.metadata).toEqual({
      abstractMinWords: 150,
      abstractMaxWords: 300,
      keywordMinCount: 5,
      keywordMaxCount: 10,
      coauthorMaxCount: 10,
    });
  });

  it('rejects duplicate categories', () => {
    expect(() =>
      journalRequirementConfigSchema.parse({
        requiredFiles: [manuscript, manuscript],
        limits: { maxBytes: 1024, maxFiles: 2, maxTotalBytes: 2048 },
      }),
    ).toThrow();
  });

  it('requires an editable main manuscript', () => {
    expect(() =>
      journalRequirementConfigSchema.parse({
        requiredFiles: [
          {
            ...manuscript,
            formats: ['pdf'],
          },
        ],
        limits: { maxBytes: 1024, maxFiles: 1, maxTotalBytes: 1024 },
      }),
    ).toThrow();
  });

  it('rejects a blind-review policy without reviewers', () => {
    expect(() =>
      journalRequirementConfigSchema.parse({
        requiredFiles: [manuscript],
        limits: { maxBytes: 1024, maxFiles: 1, maxTotalBytes: 1024 },
        preflight: { docx: { rulesVersion: 'test-v1' } },
        workflow: {
          reviewModel: 'DOUBLE_BLIND',
          requiredReviewerCount: 0,
          decisionRequiresCompletedReviews: true,
        },
      }),
    ).toThrow();
  });

  it('rejects inverted configurable metadata limits', () => {
    expect(() =>
      journalRequirementConfigSchema.parse({
        requiredFiles: [manuscript],
        limits: { maxBytes: 1024, maxFiles: 1, maxTotalBytes: 1024 },
        preflight: { docx: { rulesVersion: 'test-v1' } },
        metadata: {
          abstractMinWords: 300,
          abstractMaxWords: 150,
          keywordMinCount: 10,
          keywordMaxCount: 5,
          coauthorMaxCount: 10,
        },
      }),
    ).toThrow();
  });
});

describe('ORCID validation', () => {
  it('checks the ISO 7064 checksum', () => {
    expect(orcidSchema.safeParse('0000-0002-1825-0097').success).toBe(true);
    expect(orcidSchema.safeParse('0000-0002-1825-0098').success).toBe(false);
  });
});
