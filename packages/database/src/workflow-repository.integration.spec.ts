import { randomUUID } from 'node:crypto';
import {
  allowedTransitions,
  submissionStatuses,
  type ScopedActor,
  type SubmissionStatus,
} from '@hmqa/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { transitionSubmission } from './workflow-repository.js';

const databaseUrl = process.env.DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createPrismaClient(databaseUrl) : null;
let submissionId = '';
let userId = '';
let journalId = '';
let requirementId = '';

function actorFor(target: SubmissionStatus): ScopedActor {
  if (target === 'SUBMITTED' || target === 'REVISION_SUBMITTED' || target === 'WITHDRAWN') {
    return {
      id: userId,
      role: 'AUTHOR',
      journalIds: new Set<string>(),
      stepUpVerified: false,
    };
  }
  if (['TECHNICAL_REVIEW', 'NEEDS_CORRECTION', 'REGISTERED'].includes(target)) {
    return {
      id: randomUUID(),
      role: 'OPERATOR',
      journalIds: new Set([journalId]),
      stepUpVerified: true,
    };
  }
  if (['EDITORIAL_REVIEW', 'UNDER_REVIEW', 'REVISION_REQUESTED'].includes(target)) {
    return {
      id: randomUUID(),
      role: 'EDITOR',
      journalIds: new Set([journalId]),
      stepUpVerified: true,
    };
  }
  if (target === 'ARCHIVED') {
    return {
      id: randomUUID(),
      role: 'ADMIN',
      journalIds: new Set<string>(),
      stepUpVerified: true,
    };
  }
  return {
    id: randomUUID(),
    role: 'CHIEF_EDITOR',
    journalIds: new Set([journalId]),
    stepUpVerified: true,
  };
}

function completeContext() {
  return {
    journalId,
    ownerId: userId,
    requiredFieldsComplete: true,
    activeConsent: true,
    mandatoryFilesClean: true,
    blockingPreflightCount: 0,
    authorConfirmed: true,
    technicalReviewComplete: true,
    assignedEditor: true,
    requiredReviewersAssigned: true,
    anonymizedPackageReady: true,
    decisionRequiresCompletedReviews: true,
    requiredReviewsComplete: true,
    publicReason: 'Integration public reason',
    deadline: new Date(Date.now() + 86_400_000),
    revisionVersionCreated: true,
    decisionBasis: 'Integration decision basis',
    fourEyesRequired: false,
    publicationReference: 'INTEGRATION-2026-001',
  };
}

suite('transactional submission workflow', () => {
  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const user = await database!.user.create({
      data: { telegramUserId: BigInt(`8${Date.now()}`), telegramChatId: 100n, locale: 'ru' },
    });
    userId = user.id;
    const journal = await database!.journal.create({
      data: { code: `T${suffix}`.slice(0, 16), mode: 'NATIVE' },
    });
    journalId = journal.id;
    const requirement = await database!.journalRequirementVersion.create({
      data: {
        journalId,
        version: 1,
        state: 'PUBLISHED',
        config: { formats: ['docx'] },
        configHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        changeNote: 'integration test',
        publishedAt: new Date(),
        effectiveAt: new Date(),
      },
    });
    requirementId = requirement.id;
    const submission = await database!.submission.create({
      data: {
        publicId: `TEST-${suffix}`,
        journalId,
        ownerId: userId,
        requirementVersionId: requirement.id,
      },
    });
    submissionId = submission.id;
  });
  afterAll(async () => {
    await database?.$disconnect();
  });

  it('updates status, history, audit and notification atomically', async () => {
    const correlationId = randomUUID();
    const result = await transitionSubmission(database!, {
      submissionId,
      expectedRowVersion: 0,
      targetStatus: 'TECHNICAL_REVIEW',
      actor: {
        id: randomUUID(),
        role: 'OPERATOR',
        journalIds: new Set([journalId]),
        stepUpVerified: true,
      },
      context: { journalId, ownerId: userId },
      correlationId,
      requestId: correlationId,
      notification: {
        eventCode: 'submission.technical_review',
        locale: 'ru',
        templateVersion: 'test-v1',
        templateSnapshot: { key: 'status.technical_review' },
        variables: { public_id: 'TEST' },
      },
    });
    expect(result.toStatus).toBe('TECHNICAL_REVIEW');
    const [submission, histories, audits, notifications] = await Promise.all([
      database!.submission.findUniqueOrThrow({ where: { id: submissionId } }),
      database!.statusHistory.count({ where: { submissionId } }),
      database!.auditLog.count({ where: { entityId: submissionId } }),
      database!.notification.count({ where: { submissionId } }),
    ]);
    expect(submission).toMatchObject({ status: 'TECHNICAL_REVIEW', rowVersion: 1 });
    expect({ histories, audits, notifications }).toEqual({
      histories: 1,
      audits: 1,
      notifications: 1,
    });
  });

  it('does not partially write an invalid transition', async () => {
    await expect(
      transitionSubmission(database!, {
        submissionId,
        expectedRowVersion: 1,
        targetStatus: 'ACCEPTED',
        actor: {
          id: randomUUID(),
          role: 'CHIEF_EDITOR',
          journalIds: new Set([journalId]),
          stepUpVerified: true,
        },
        context: {
          journalId,
          ownerId: userId,
          decisionBasis: 'invalid path',
          publicReason: 'invalid path',
        },
        correlationId: randomUUID(),
        requestId: randomUUID(),
        notification: {
          eventCode: 'invalid',
          locale: 'ru',
          templateVersion: 'test',
          templateSnapshot: { key: 'status.accepted' },
          variables: {},
        },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(await database!.statusHistory.count({ where: { submissionId } })).toBe(1);
  });

  it('atomically persists history, audit and notification for every allowed transition', async () => {
    let executed = 0;
    for (const from of submissionStatuses) {
      for (const to of allowedTransitions[from]) {
        const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
        const submission = await database!.submission.create({
          data: {
            publicId: `WF-${suffix}`,
            journalId,
            ownerId: userId,
            requirementVersionId: requirementId,
            status: from,
          },
        });
        const correlationId = randomUUID();
        const result = await transitionSubmission(database!, {
          submissionId: submission.id,
          expectedRowVersion: 0,
          targetStatus: to,
          actor: actorFor(to),
          context: completeContext(),
          publicReason: 'Integration public reason',
          internalReason: 'Integration decision basis',
          correlationId,
          requestId: correlationId,
          notification: {
            eventCode: `submission.${to.toLowerCase()}`,
            locale: 'ru',
            templateVersion: 'integration-v1',
            templateSnapshot: { key: `status.${to.toLowerCase()}` },
            variables: { public_id: submission.publicId },
          },
        });
        expect(result).toMatchObject({ fromStatus: from, toStatus: to, rowVersion: 1 });
        const [stored, histories, audits, notifications] = await Promise.all([
          database!.submission.findUniqueOrThrow({ where: { id: submission.id } }),
          database!.statusHistory.count({ where: { submissionId: submission.id } }),
          database!.auditLog.count({ where: { entityId: submission.id } }),
          database!.notification.count({ where: { submissionId: submission.id } }),
        ]);
        expect(stored.status).toBe(to);
        expect({ histories, audits, notifications }).toEqual({
          histories: 1,
          audits: 1,
          notifications: 1,
        });
        executed += 1;
      }
    }
    expect(executed).toBeGreaterThan(0);
  });
});
