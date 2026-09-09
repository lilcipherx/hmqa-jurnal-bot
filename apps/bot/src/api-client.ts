import type { Locale } from '@hmqa/i18n';
import { z } from 'zod';

const draftSchema = z.object({
  id: z.uuid(),
  journalId: z.uuid().nullable(),
  requirementVersionId: z.uuid().nullable(),
  machineState: z.string(),
  expectedInputType: z.string().nullable(),
  context: z.record(z.string(), z.unknown()),
  rowVersion: z.number().int(),
  expiresAt: z.coerce.date(),
  files: z
    .array(
      z.object({
        category: z.string(),
        replacedAt: z.coerce.date().nullable(),
        file: z.object({
          id: z.uuid(),
          originalName: z.string(),
          scanStatus: z.string(),
          storageStatus: z.string(),
          sizeBytes: z.union([z.string(), z.number(), z.bigint()]).transform(String),
        }),
      }),
    )
    .optional()
    .default([]),
  preflightRuns: z
    .array(
      z.object({
        fileId: z.uuid(),
        status: z.string(),
        blockingCount: z.number().int(),
        errorCount: z.number().int(),
        warningCount: z.number().int(),
        findings: z.unknown(),
      }),
    )
    .optional()
    .default([]),
  requirementVersion: z
    .object({
      id: z.uuid(),
      version: z.number().int(),
      state: z.string(),
      config: z.unknown(),
      localizations: z.array(
        z.object({
          locale: z.enum(['UZ_LATN', 'RU', 'EN']),
          title: z.string(),
          summary: z.string(),
          body: z.string(),
          help: z.string().nullable(),
          contact: z.string().nullable(),
        }),
      ),
    })
    .nullable()
    .optional(),
  journal: z
    .object({
      code: z.string(),
      localizations: z.array(
        z.object({
          locale: z.enum(['UZ_LATN', 'RU', 'EN']),
          name: z.string(),
          description: z.string(),
          contactText: z.string().nullable(),
        }),
      ),
      currentRequirement: z
        .object({
          id: z.uuid(),
          version: z.number().int(),
          config: z.unknown(),
          localizations: z.array(
            z.object({
              locale: z.enum(['UZ_LATN', 'RU', 'EN']),
              title: z.string(),
              summary: z.string(),
              body: z.string(),
              help: z.string().nullable(),
              contact: z.string().nullable(),
            }),
          ),
        })
        .nullable(),
    })
    .nullable()
    .optional(),
});

const userStateSchema = z.object({
  id: z.uuid(),
  locale: z.enum(['uz-Latn', 'ru', 'en']).nullable(),
  status: z.string(),
  consentActive: z.boolean(),
  activeDraft: draftSchema.nullable(),
  profile: z
    .object({
      fullName: z.string(),
      organization: z.string(),
      position: z.string(),
      degreeCode: z.string(),
      degreeCustom: z.string().nullable(),
      titleCode: z.string(),
      titleCustom: z.string().nullable(),
      email: z.string(),
      phone: z.string(),
      updatedAt: z.coerce.date(),
    })
    .nullable(),
});

const journalSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  mode: z.string(),
  name: z.string(),
  description: z.string(),
  contactText: z.string().nullable().optional(),
  requirements: z
    .object({
      id: z.uuid(),
      version: z.number(),
      effectiveAt: z.coerce.date().nullable(),
      state: z.string(),
      title: z.string(),
      summary: z.string(),
      body: z.string(),
      help: z.string().nullable(),
    })
    .nullable(),
});

const telegramContentSchema = z.object({
  contact: z.object({
    phone: z.string().nullable(),
    email: z.string().nullable(),
    telegram: z.string().nullable(),
    address: z.string().nullable(),
    workingHours: z.string().nullable(),
    note: z.string().nullable(),
  }),
  content: z.record(z.string(), z.string().nullable()),
});

const submissionSchema = z.object({
  id: z.uuid(),
  publicId: z.string(),
  status: z.string(),
  rowVersion: z.number().int(),
  currentVersionNo: z.number().int(),
  journalCode: z.string(),
  updatedAt: z.coerce.date(),
});
const notificationSchema = z.object({
  id: z.uuid(),
  eventCode: z.string(),
  status: z.string(),
  createdAt: z.coerce.date(),
  variables: z.record(z.string(), z.unknown()),
  templateSnapshot: z.unknown(),
});
const consentSchema = z.object({
  id: z.uuid(),
  policyVersion: z.string(),
  scope: z.string(),
  granted: z.boolean(),
  grantedAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
  locale: z.enum(['uz-Latn', 'ru', 'en']),
});
const privacyRequestSchema = z.object({
  id: z.uuid(),
  publicId: z.string(),
  type: z.enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'RESTRICTION']),
  status: z.enum([
    'RECEIVED',
    'IDENTITY_VERIFICATION',
    'IN_REVIEW',
    'APPROVED',
    'DENIED',
    'EXECUTING',
    'COMPLETED',
    'CANCELLED',
  ]),
  dueAt: z.coerce.date(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  decisionReason: z.string().nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
});
const submissionDetailSchema = z.object({
  id: z.uuid(),
  publicId: z.string(),
  status: z.string(),
  currentVersionNo: z.number().int(),
  submittedAt: z.coerce.date(),
  journal: z.object({ code: z.string() }),
  requirementVersion: z.object({ version: z.number().int(), config: z.unknown() }),
  statusHistory: z.array(
    z.object({
      toStatus: z.string(),
      publicReason: z.string().nullable(),
      createdAt: z.coerce.date(),
    }),
  ),
  messageThread: z
    .object({ messages: z.array(z.object({ body: z.string(), createdAt: z.coerce.date() })) })
    .nullable(),
  versions: z.array(
    z.object({
      versionNo: z.number().int().positive(),
      createdAt: z.coerce.date(),
      files: z.array(
        z.object({
          category: z.string(),
          required: z.boolean(),
          versionNo: z.number().int().positive(),
          createdAt: z.coerce.date(),
          file: z.object({
            id: z.uuid(),
            originalName: z.string(),
            extension: z.string().nullable(),
            sizeBytes: z.union([z.string(), z.number(), z.bigint()]).transform(String),
            sha256: z.string().nullable(),
            scanStatus: z.string(),
            storageStatus: z.string(),
          }),
        }),
      ),
    }),
  ),
});

export type DraftState = z.infer<typeof draftSchema>;
export type UserState = z.infer<typeof userStateSchema>;
export type JournalSummary = z.infer<typeof journalSchema>;

export class HmqaApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export class HmqaApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceSecret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetcher(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-hmqa-service-secret': this.serviceSecret,
        ...init.headers,
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body: unknown =
      response.status === 204 ? null : ((await response.json().catch(() => null)) as unknown);
    if (!response.ok) {
      const code =
        typeof body === 'object' && body && 'code' in body ? String(body.code) : 'API_ERROR';
      throw new HmqaApiError(response.status, code);
    }
    return body;
  }

  async claimUpdate(updateId: number): Promise<{ claimed: boolean; correlationId: string }> {
    return z.object({ claimed: z.boolean(), correlationId: z.uuid() }).parse(
      await this.request('/api/v1/internal/telegram/updates/claim', {
        method: 'POST',
        body: JSON.stringify({ updateId: String(updateId) }),
      }),
    );
  }

  async completeUpdate(updateId: number, outcome: 'PROCESSED' | 'IGNORED'): Promise<void> {
    await this.request(`/api/v1/internal/telegram/updates/${updateId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ outcome }),
    });
  }

  async releaseUpdate(updateId: number): Promise<void> {
    await this.request(`/api/v1/internal/telegram/updates/${updateId}/release`, { method: 'POST' });
  }

  async syncUser(input: {
    telegramUserId: string;
    telegramChatId: string;
    username?: string | null;
  }): Promise<UserState> {
    return userStateSchema.parse(
      await this.request('/api/v1/internal/telegram/users/sync', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    );
  }

  async setLocale(telegramUserId: string, locale: Locale): Promise<void> {
    await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/locale`, {
      method: 'PATCH',
      body: JSON.stringify({ locale }),
    });
  }

  async getTelegramContent(locale: Locale, journalId?: string) {
    const query = new URLSearchParams({ locale });
    if (journalId) query.set('journalId', journalId);
    return telegramContentSchema.parse(
      await this.request(`/api/v1/internal/telegram/content?${query.toString()}`),
    );
  }

  async createProfileDraft(
    telegramUserId: string,
    section: 'all' | 'name' | 'phone' | 'email' | 'organization' | 'position' | 'degree' | 'title',
  ): Promise<DraftState> {
    return draftSchema.parse(
      await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/profile-draft`, {
        method: 'POST',
        body: JSON.stringify({ section }),
      }),
    );
  }

  async finalizeProfileDraft(telegramUserId: string, draft: DraftState): Promise<void> {
    await this.request(
      `/api/v1/internal/telegram/users/${telegramUserId}/profile-drafts/${draft.id}/submit`,
      {
        method: 'POST',
        body: JSON.stringify({ expectedRowVersion: draft.rowVersion }),
      },
    );
  }

  async recordConsent(telegramUserId: string, locale: Locale, granted: boolean): Promise<void> {
    await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/consents`, {
      method: 'POST',
      body: JSON.stringify({
        policyVersion: 'privacy-v1',
        scope: 'submission_processing',
        locale,
        granted,
      }),
    });
  }

  async listConsents(telegramUserId: string) {
    return z
      .object({ items: z.array(consentSchema) })
      .parse(await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/consents`));
  }

  async listPrivacyRequests(telegramUserId: string) {
    return z
      .object({ items: z.array(privacyRequestSchema) })
      .parse(
        await this.request(
          `/api/v1/internal/telegram/users/${telegramUserId}/data-subject-requests`,
        ),
      );
  }

  async createPrivacyRequest(
    telegramUserId: string,
    type: 'ACCESS' | 'RECTIFICATION' | 'ERASURE' | 'RESTRICTION',
  ) {
    return privacyRequestSchema
      .extend({ created: z.boolean() })
      .parse(
        await this.request(
          `/api/v1/internal/telegram/users/${telegramUserId}/data-subject-requests`,
          { method: 'POST', body: JSON.stringify({ type }) },
        ),
      );
  }

  async listJournals(locale: Locale): Promise<JournalSummary[]> {
    const value = z
      .object({ items: z.array(journalSchema) })
      .parse(await this.request(`/api/v1/catalog/journals?locale=${encodeURIComponent(locale)}`));
    return value.items;
  }

  async createDraft(telegramUserId: string, journalId?: string): Promise<DraftState> {
    return draftSchema.parse(
      await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/drafts`, {
        method: 'POST',
        body: JSON.stringify(journalId ? { journalId } : {}),
      }),
    );
  }

  async updateDraft(
    telegramUserId: string,
    draft: DraftState,
    machineState: string,
    expectedInputType: string | null,
    contextPatch: Record<string, unknown> = {},
  ): Promise<DraftState> {
    return draftSchema.parse(
      await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          expectedRowVersion: draft.rowVersion,
          machineState,
          expectedInputType,
          contextPatch,
        }),
      }),
    );
  }

  async attachTelegramFile(
    telegramUserId: string,
    draft: DraftState,
    file: {
      fileId: string;
      fileUniqueId: string;
      fileName: string;
      declaredMime?: string;
      sizeBytes: number;
      category: string;
    },
  ): Promise<DraftState> {
    return draftSchema.parse(
      await this.request(
        `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/files`,
        {
          method: 'POST',
          body: JSON.stringify({
            ...file,
            expectedRowVersion: draft.rowVersion,
          }),
        },
      ),
    );
  }

  async finalizeDraft(
    telegramUserId: string,
    draft: DraftState,
  ): Promise<{
    submissionId: string;
    publicId: string;
    status: string;
    submittedAt: Date;
    receiptJobId: string;
  }> {
    return z
      .object({
        submissionId: z.uuid(),
        publicId: z.string(),
        status: z.string(),
        submittedAt: z.coerce.date(),
        receiptJobId: z.uuid(),
      })
      .parse(
        await this.request(
          `/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draft.id}/submit`,
          {
            method: 'POST',
            headers: { 'idempotency-key': draft.id },
            body: JSON.stringify({ expectedRowVersion: draft.rowVersion }),
          },
        ),
      );
  }

  async cancelDraft(telegramUserId: string, draftId: string): Promise<void> {
    await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/drafts/${draftId}`, {
      method: 'DELETE',
    });
  }

  async listSubmissions(telegramUserId: string) {
    return z
      .object({ items: z.array(submissionSchema) })
      .parse(await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/submissions`));
  }

  async getSubmission(telegramUserId: string, submissionId: string) {
    return submissionDetailSchema.parse(
      await this.request(
        `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${submissionId}`,
      ),
    );
  }

  async getSubmissionFileUrl(telegramUserId: string, fileId: string) {
    return z
      .object({ url: z.url(), expiresInSeconds: z.number().int().positive() })
      .parse(
        await this.request(
          `/api/v1/internal/telegram/users/${telegramUserId}/files/${fileId}/download`,
        ),
      );
  }

  async getSubmissionReceipt(telegramUserId: string, submissionId: string) {
    return z
      .object({
        status: z.enum(['PENDING', 'PROCESSING', 'READY', 'FAILED']),
        submissionVersion: z.number().int().positive(),
        url: z.url().optional(),
        expiresInSeconds: z.number().int().positive().optional(),
      })
      .parse(
        await this.request(
          `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${submissionId}/receipt`,
        ),
      );
  }

  async createRevisionDraft(telegramUserId: string, submissionId: string): Promise<DraftState> {
    return draftSchema.parse(
      await this.request(
        `/api/v1/internal/telegram/users/${telegramUserId}/submissions/${submissionId}/revision-draft`,
        { method: 'POST', body: '{}' },
      ),
    );
  }

  async listNotifications(telegramUserId: string) {
    return z
      .object({ items: z.array(notificationSchema) })
      .parse(await this.request(`/api/v1/internal/telegram/users/${telegramUserId}/notifications`));
  }
}
