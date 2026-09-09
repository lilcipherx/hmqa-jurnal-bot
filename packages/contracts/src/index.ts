import { submissionStatuses } from '@hmqa/domain';
import { z } from 'zod';

export const localeSchema = z.enum(['uz-Latn', 'ru', 'en']);
export const submissionStatusSchema = z.enum(submissionStatuses);

export const uploadFormatSchema = z.enum(['docx', 'pdf']);
export const preflightSeveritySchema = z.enum(['BLOCKING', 'ERROR', 'WARNING', 'INFO']);

const measuredRule = z
  .object({
    severity: preflightSeveritySchema.default('ERROR'),
  })
  .strict();

export const docxPreflightPolicySchema = z
  .object({
    rulesVersion: z.string().trim().min(1).max(100),
    renderedPages: measuredRule
      .extend({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      })
      .refine((value) => value.max >= value.min, { message: 'max must be at least min' })
      .optional(),
    page: measuredRule
      .extend({
        widthMm: z.number().positive().max(1_000),
        heightMm: z.number().positive().max(1_000),
        toleranceMm: z.number().nonnegative().max(20).default(1),
      })
      .optional(),
    margins: measuredRule
      .extend({
        leftMm: z.number().nonnegative().max(200),
        rightMm: z.number().nonnegative().max(200),
        topMm: z.number().nonnegative().max(200),
        bottomMm: z.number().nonnegative().max(200),
        toleranceMm: z.number().nonnegative().max(20).default(1),
      })
      .optional(),
    defaultFont: measuredRule
      .extend({
        family: z.string().trim().min(1).max(100),
        sizePt: z.number().positive().max(100),
        tolerancePt: z.number().nonnegative().max(10).default(0.5),
      })
      .optional(),
    lineSpacing: measuredRule
      .extend({
        multiple: z.number().positive().max(10),
        tolerance: z.number().nonnegative().max(1).default(0.05),
      })
      .optional(),
    requiredMarkers: z
      .array(
        measuredRule.extend({
          code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
          anyOf: z.array(z.string().trim().min(2).max(200)).min(1).max(20),
        }),
      )
      .max(50)
      .default([]),
  })
  .strict();

export const orcidSchema = z
  .string()
  .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/)
  .refine((value) => {
    const compact = value.replaceAll('-', '');
    let total = 0;
    for (const digit of compact.slice(0, 15)) total = (total + Number(digit)) * 2;
    const remainder = total % 11;
    const result = (12 - remainder) % 11;
    return (result === 10 ? 'X' : String(result)) === compact[15];
  }, 'invalid ORCID checksum');

export const journalRequirementFilePolicySchema = z
  .object({
    category: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/),
    labels: z
      .object({
        'uz-Latn': z.string().trim().min(1).max(200),
        ru: z.string().trim().min(1).max(200),
        en: z.string().trim().min(1).max(200),
      })
      .strict(),
    formats: z.array(uploadFormatSchema).min(1).max(2),
    required: z.boolean(),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(19 * 1024 * 1024)
      .optional(),
    preflightRequired: z.boolean().default(true),
  })
  .strict();

export const journalWorkflowPolicySchema = z
  .object({
    reviewModel: z.enum(['NO_EXTERNAL_REVIEW', 'SINGLE_BLIND', 'DOUBLE_BLIND']),
    requiredReviewerCount: z.number().int().min(0).max(10),
    decisionRequiresCompletedReviews: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.reviewModel === 'NO_EXTERNAL_REVIEW' && value.requiredReviewerCount !== 0)
      context.addIssue({
        code: 'custom',
        path: ['requiredReviewerCount'],
        message: 'NO_EXTERNAL_REVIEW requires zero reviewers',
      });
    if (value.reviewModel === 'NO_EXTERNAL_REVIEW' && value.decisionRequiresCompletedReviews)
      context.addIssue({
        code: 'custom',
        path: ['decisionRequiresCompletedReviews'],
        message: 'NO_EXTERNAL_REVIEW cannot require completed reviews',
      });
    if (value.reviewModel !== 'NO_EXTERNAL_REVIEW' && value.requiredReviewerCount < 1)
      context.addIssue({
        code: 'custom',
        path: ['requiredReviewerCount'],
        message: 'Blind review requires at least one reviewer',
      });
  });

export const journalRequirementConfigSchema = z
  .object({
    requiredFiles: z.array(journalRequirementFilePolicySchema).min(1).max(20),
    limits: z
      .object({
        maxBytes: z
          .number()
          .int()
          .positive()
          .max(19 * 1024 * 1024),
        maxFiles: z.number().int().positive().max(20).default(10),
        maxTotalBytes: z
          .number()
          .int()
          .positive()
          .max(100 * 1024 * 1024)
          .default(50 * 1024 * 1024),
      })
      .strict(),
    preflight: z
      .object({
        docx: docxPreflightPolicySchema.optional(),
      })
      .strict()
      .optional(),
    workflow: journalWorkflowPolicySchema.default({
      reviewModel: 'NO_EXTERNAL_REVIEW',
      requiredReviewerCount: 0,
      decisionRequiresCompletedReviews: false,
    }),
  })
  .passthrough()
  .superRefine((value, context) => {
    const categories = new Set<string>();
    for (const [index, policy] of value.requiredFiles.entries()) {
      if (categories.has(policy.category)) {
        context.addIssue({
          code: 'custom',
          path: ['requiredFiles', index, 'category'],
          message: 'File categories must be unique',
        });
      }
      categories.add(policy.category);
      if (new Set(policy.formats).size !== policy.formats.length) {
        context.addIssue({
          code: 'custom',
          path: ['requiredFiles', index, 'formats'],
          message: 'File formats must be unique',
        });
      }
    }
    const manuscript = value.requiredFiles.find((policy) => policy.category === 'MANUSCRIPT');
    if (!manuscript?.required || !manuscript.formats.includes('docx')) {
      context.addIssue({
        code: 'custom',
        path: ['requiredFiles'],
        message: 'A required editable DOCX MANUSCRIPT policy is mandatory',
      });
    }
    if (
      value.requiredFiles.some(
        (policy) => policy.preflightRequired && policy.formats.includes('docx'),
      ) &&
      !value.preflight?.docx
    ) {
      context.addIssue({
        code: 'custom',
        path: ['preflight', 'docx'],
        message: 'A versioned DOCX preflight policy is required for DOCX preflight files',
      });
    }
    if (value.limits.maxFiles < value.requiredFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['limits', 'maxFiles'],
        message: 'maxFiles cannot be lower than the configured category count',
      });
    }
  });

export const apiErrorSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  messageKey: z.string().min(1),
  correlationId: z.uuid(),
  fieldErrors: z
    .array(
      z.object({
        field: z.string().min(1),
        code: z.string().min(1),
        messageKey: z.string().min(1),
      }),
    )
    .optional(),
});

export const transitionRequestSchema = z
  .object({
    targetStatus: submissionStatusSchema,
    expectedRowVersion: z.number().int().nonnegative(),
    publicReason: z.string().trim().min(1).max(4000).optional(),
    internalReason: z.string().trim().min(1).max(4000).optional(),
    deadline: z.iso.datetime().optional(),
    publicationReference: z.string().trim().url().max(2048).optional(),
    decisionProposalId: z.uuid().optional(),
    confirm: z.literal(true),
  })
  .strict();

export const cursorPageSchema = z.object({
  items: z.array(z.unknown()),
  nextCursor: z.string().nullable(),
});

export const authorProfileSchema = z
  .object({
    firstName: z.string().trim().min(2).max(100),
    lastName: z.string().trim().min(2).max(100),
    middleName: z.string().trim().max(100).nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/),
    email: z.email().transform((value) => {
      const [local, domain] = value.split('@');
      return `${local}@${domain?.toLowerCase()}`;
    }),
    organization: z.string().trim().min(2).max(300),
    position: z.string().trim().min(2).max(200),
    degree: z.string().trim().max(200).nullable(),
    title: z.string().trim().max(200).nullable(),
    orcid: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/)
      .nullable(),
  })
  .strict();

export type ApiError = z.infer<typeof apiErrorSchema>;
export type TransitionRequest = z.infer<typeof transitionRequestSchema>;
export type AuthorProfileInput = z.infer<typeof authorProfileSchema>;
export type JournalRequirementConfig = z.infer<typeof journalRequirementConfigSchema>;
export type JournalRequirementFilePolicy = z.infer<typeof journalRequirementFilePolicySchema>;
export type DocxPreflightPolicy = z.infer<typeof docxPreflightPolicySchema>;
export type PreflightSeverity = z.infer<typeof preflightSeveritySchema>;
