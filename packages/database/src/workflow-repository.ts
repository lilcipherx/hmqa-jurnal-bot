import { createHash, randomUUID } from 'node:crypto';
import {
  assertTransitionAllowed,
  type ScopedActor,
  type SubmissionStatus as DomainSubmissionStatus,
  type TransitionGuardContext,
} from '@hmqa/domain';
import type { Prisma } from './generated/client/client.js';
import type { DatabaseClient } from './client.js';
import { serializableTransactionWithRetry } from './transaction-retry.js';

export interface TransitionSubmissionInput {
  readonly submissionId: string;
  readonly expectedRowVersion: number;
  readonly targetStatus: DomainSubmissionStatus;
  readonly decisionProposalId?: string;
  readonly actor: ScopedActor;
  readonly context: TransitionGuardContext;
  readonly publicReason?: string;
  readonly internalReason?: string;
  readonly correlationId: string;
  readonly requestId: string;
  readonly ipHash?: string;
  readonly userAgentHash?: string;
  readonly notification: {
    readonly eventCode: string;
    readonly locale: 'uz-Latn' | 'ru' | 'en';
    readonly templateVersion: string;
    readonly templateSnapshot: Prisma.InputJsonValue;
    readonly variables: Prisma.InputJsonValue;
  };
}

export class ConcurrentTransitionError extends Error {
  constructor() {
    super('CONCURRENT_TRANSITION');
    this.name = 'ConcurrentTransitionError';
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function localeToDatabase(locale: 'uz-Latn' | 'ru' | 'en') {
  return locale === 'uz-Latn' ? ('uz_Latn' as const) : locale;
}

export async function transitionSubmission(
  database: DatabaseClient,
  input: TransitionSubmissionInput,
) {
  return serializableTransactionWithRetry(
    database,
    async (tx) => {
      const submission = await tx.submission.findUnique({
        where: { id: input.submissionId },
        select: {
          id: true,
          ownerId: true,
          journalId: true,
          status: true,
          rowVersion: true,
        },
      });
      if (!submission) throw new Error('SUBMISSION_NOT_FOUND');
      if (submission.rowVersion !== input.expectedRowVersion) throw new ConcurrentTransitionError();

      const isDecision = input.targetStatus === 'ACCEPTED' || input.targetStatus === 'REJECTED';
      const proposal = input.decisionProposalId
        ? await tx.decisionProposal.findUnique({ where: { id: input.decisionProposalId } })
        : null;
      if (
        proposal &&
        (proposal.submissionId !== submission.id ||
          proposal.status !== 'PREPARED' ||
          proposal.decision !== (input.targetStatus === 'ACCEPTED' ? 'ACCEPT' : 'REJECT'))
      ) {
        throw new Error('DECISION_PROPOSAL_INVALID');
      }
      const effectivePublicReason =
        isDecision && proposal ? proposal.publicReason : input.publicReason;
      const effectiveInternalReason =
        isDecision && proposal ? proposal.internalBasis : input.internalReason;

      assertTransitionAllowed(submission.status, input.targetStatus, input.actor, {
        ...input.context,
        ownerId: submission.ownerId,
        journalId: submission.journalId,
        ...(effectivePublicReason ? { publicReason: effectivePublicReason } : {}),
        ...(effectiveInternalReason ? { decisionBasis: effectiveInternalReason } : {}),
        ...(isDecision && proposal ? { decisionPreparedBy: proposal.preparedById } : {}),
      });

      const updated = await tx.submission.updateMany({
        where: {
          id: submission.id,
          rowVersion: input.expectedRowVersion,
          status: submission.status,
        },
        data: {
          status: input.targetStatus,
          rowVersion: { increment: 1 },
          ...(input.targetStatus === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
          ...(input.targetStatus === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
          ...(['NEEDS_CORRECTION', 'REVISION_REQUESTED'].includes(input.targetStatus)
            ? { responseDeadline: input.context.deadline }
            : {}),
          ...(['TECHNICAL_REVIEW', 'REVISION_SUBMITTED'].includes(input.targetStatus)
            ? { responseDeadline: null }
            : {}),
          ...(input.targetStatus === 'PUBLISHED'
            ? { publicationReference: input.context.publicationReference }
            : {}),
          ...(input.targetStatus === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
        },
      });
      if (updated.count !== 1) throw new ConcurrentTransitionError();

      if (isDecision && proposal) {
        const approved = await tx.decisionProposal.updateMany({
          where: { id: proposal.id, status: 'PREPARED', approvedById: null },
          data: { status: 'APPROVED', approvedById: input.actor.id, approvedAt: new Date() },
        });
        if (approved.count !== 1) throw new ConcurrentTransitionError();
        await tx.decisionProposal.updateMany({
          where: {
            submissionId: submission.id,
            status: 'PREPARED',
            id: { not: proposal.id },
          },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
      }

      const statusEvent = await tx.statusHistory.create({
        data: {
          submissionId: submission.id,
          fromStatus: submission.status,
          toStatus: input.targetStatus,
          actorType: input.actor.role === 'AUTHOR' ? 'USER' : 'EMPLOYEE',
          actorId: input.actor.id,
          actorRole: input.actor.role,
          publicReason: effectivePublicReason ?? null,
          internalReason: effectiveInternalReason ?? null,
          correlationId: input.correlationId,
        },
      });

      const eventId = randomUUID();
      const notification = await tx.notification.create({
        data: {
          eventId,
          submissionId: submission.id,
          userId: submission.ownerId,
          eventCode: input.notification.eventCode,
          locale: localeToDatabase(input.notification.locale),
          templateVersion: input.notification.templateVersion,
          templateSnapshot: input.notification.templateSnapshot,
          variables: input.notification.variables,
        },
      });

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(4815162342)`;
      const previousAudit = await tx.auditLog.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { eventHash: true },
      });
      const auditPayload = JSON.stringify({
        action: 'submission.status.transition',
        actorId: input.actor.id,
        actorRole: input.actor.role,
        entityId: submission.id,
        from: submission.status,
        to: input.targetStatus,
        correlationId: input.correlationId,
        previous: previousAudit?.eventHash ?? null,
      });
      const audit = await tx.auditLog.create({
        data: {
          actorType: input.actor.role === 'AUTHOR' ? 'USER' : 'EMPLOYEE',
          actorId: input.actor.id,
          actorRole: input.actor.role,
          action: 'submission.status.transition',
          entity: 'Submission',
          entityId: submission.id,
          journalId: submission.journalId,
          before: { status: submission.status, rowVersion: submission.rowVersion },
          after: {
            status: input.targetStatus,
            rowVersion: submission.rowVersion + 1,
            ...(['NEEDS_CORRECTION', 'REVISION_REQUESTED'].includes(input.targetStatus)
              ? { responseDeadline: input.context.deadline?.toISOString() }
              : {}),
            ...(input.targetStatus === 'PUBLISHED'
              ? { publicationReference: input.context.publicationReference }
              : {}),
          },
          outcome: 'SUCCESS',
          ipHash: input.ipHash ?? null,
          userAgentHash: input.userAgentHash ?? null,
          requestId: input.requestId,
          correlationId: input.correlationId,
          prevHash: previousAudit?.eventHash ?? null,
          eventHash: sha256(auditPayload),
        },
      });

      return {
        submissionId: submission.id,
        fromStatus: submission.status,
        toStatus: input.targetStatus,
        rowVersion: submission.rowVersion + 1,
        statusEventId: statusEvent.id,
        notificationId: notification.id,
        auditId: audit.id,
      };
    },
    { lockAuditChain: true, maxWait: 5_000, timeout: 10_000 },
  );
}
