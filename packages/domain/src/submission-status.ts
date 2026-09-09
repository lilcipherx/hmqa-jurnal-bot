import type { Permission, Role } from './permissions.js';
import { hasJournalScope, hasPermission, type ScopedActor } from './permissions.js';

export const submissionStatuses = [
  'DRAFT',
  'SUBMITTED',
  'TECHNICAL_REVIEW',
  'NEEDS_CORRECTION',
  'REGISTERED',
  'EDITORIAL_REVIEW',
  'UNDER_REVIEW',
  'REVISION_REQUESTED',
  'REVISION_SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'COPYEDITING',
  'LAYOUT',
  'PUBLISHED',
  'WITHDRAWN',
  'ARCHIVED',
] as const;

export type SubmissionStatus = (typeof submissionStatuses)[number];

export const legacyStatusAliases = {
  AUTO_CHECK: 'TECHNICAL_REVIEW',
  NEEDS_FIX: 'NEEDS_CORRECTION',
  EDITORIAL_SCREENING: 'EDITORIAL_REVIEW',
} as const satisfies Record<string, SubmissionStatus>;

export type LegacySubmissionStatus = keyof typeof legacyStatusAliases;

export function normalizeSubmissionStatus(
  value: SubmissionStatus | LegacySubmissionStatus,
): SubmissionStatus {
  return value in legacyStatusAliases
    ? legacyStatusAliases[value as LegacySubmissionStatus]
    : (value as SubmissionStatus);
}

export const allowedTransitions = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['TECHNICAL_REVIEW', 'WITHDRAWN'],
  TECHNICAL_REVIEW: ['NEEDS_CORRECTION', 'REGISTERED', 'WITHDRAWN'],
  NEEDS_CORRECTION: ['TECHNICAL_REVIEW', 'WITHDRAWN'],
  REGISTERED: ['EDITORIAL_REVIEW', 'WITHDRAWN'],
  EDITORIAL_REVIEW: ['UNDER_REVIEW', 'REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  UNDER_REVIEW: ['REVISION_REQUESTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  REVISION_REQUESTED: ['REVISION_SUBMITTED', 'WITHDRAWN'],
  REVISION_SUBMITTED: ['UNDER_REVIEW', 'EDITORIAL_REVIEW', 'WITHDRAWN'],
  ACCEPTED: ['COPYEDITING'],
  REJECTED: ['ARCHIVED'],
  COPYEDITING: ['LAYOUT'],
  LAYOUT: ['PUBLISHED'],
  PUBLISHED: ['ARCHIVED'],
  WITHDRAWN: ['ARCHIVED'],
  ARCHIVED: [],
} as const satisfies Record<SubmissionStatus, readonly SubmissionStatus[]>;

export interface TransitionGuardContext {
  readonly journalId: string;
  readonly ownerId: string;
  readonly requiredFieldsComplete?: boolean;
  readonly activeConsent?: boolean;
  readonly mandatoryFilesClean?: boolean;
  readonly blockingPreflightCount?: number;
  readonly authorConfirmed?: boolean;
  readonly technicalReviewComplete?: boolean;
  readonly assignedEditor?: boolean;
  readonly requiredReviewersAssigned?: boolean;
  readonly anonymizedPackageReady?: boolean;
  readonly decisionRequiresCompletedReviews?: boolean;
  readonly requiredReviewsComplete?: boolean;
  readonly publicReason?: string;
  readonly deadline?: Date;
  readonly revisionVersionCreated?: boolean;
  readonly decisionBasis?: string;
  readonly fourEyesRequired?: boolean;
  readonly decisionPreparedBy?: string;
  readonly publicationReference?: string;
}

export type TransitionDenialCode =
  'INVALID_TRANSITION' | 'FORBIDDEN' | 'OUT_OF_SCOPE' | 'STEP_UP_REQUIRED' | 'GUARD_FAILED';

export class TransitionDeniedError extends Error {
  constructor(
    readonly code: TransitionDenialCode,
    readonly details: readonly string[] = [],
  ) {
    super(code);
    this.name = 'TransitionDeniedError';
  }
}

const technicalTargets = new Set<SubmissionStatus>([
  'TECHNICAL_REVIEW',
  'NEEDS_CORRECTION',
  'REGISTERED',
]);
const editorialTargets = new Set<SubmissionStatus>([
  'EDITORIAL_REVIEW',
  'UNDER_REVIEW',
  'REVISION_REQUESTED',
]);
const decisionTargets = new Set<SubmissionStatus>(['ACCEPTED', 'REJECTED']);

function requiredPermission(to: SubmissionStatus, actorRole: Role): Permission | undefined {
  if (to === 'SUBMITTED' || to === 'REVISION_SUBMITTED') {
    return actorRole === 'AUTHOR' ? 'submission:create:self' : 'submission:editorial-review';
  }
  if (to === 'WITHDRAWN') {
    return actorRole === 'AUTHOR' ? 'submission:withdraw:self' : 'submission:editorial-review';
  }
  if (technicalTargets.has(to)) return 'submission:technical-review';
  if (editorialTargets.has(to)) return 'submission:editorial-review';
  if (decisionTargets.has(to)) {
    return 'submission:decision:approve';
  }
  if (to === 'COPYEDITING' || to === 'LAYOUT' || to === 'PUBLISHED') return 'submission:publish';
  if (to === 'ARCHIVED') return 'operations:read';
  return undefined;
}

function collectGuardFailures(
  from: SubmissionStatus,
  to: SubmissionStatus,
  actor: ScopedActor,
  context: TransitionGuardContext,
): string[] {
  const failed: string[] = [];
  if (from === 'DRAFT' && to === 'SUBMITTED') {
    if (!context.requiredFieldsComplete) failed.push('requiredFieldsComplete');
    if (!context.activeConsent) failed.push('activeConsent');
    if (!context.mandatoryFilesClean) failed.push('mandatoryFilesClean');
    if ((context.blockingPreflightCount ?? 1) !== 0) failed.push('blockingPreflightCount');
    if (!context.authorConfirmed) failed.push('authorConfirmed');
  }
  if (to === 'NEEDS_CORRECTION' || to === 'REVISION_REQUESTED') {
    if (!context.publicReason?.trim()) failed.push('publicReason');
    if (!context.deadline) failed.push('deadline');
  }
  if (to === 'REGISTERED' && !context.technicalReviewComplete) {
    failed.push('technicalReviewComplete');
  }
  if (to === 'EDITORIAL_REVIEW' && !context.assignedEditor) failed.push('assignedEditor');
  if (to === 'UNDER_REVIEW') {
    if (!context.requiredReviewersAssigned) failed.push('requiredReviewersAssigned');
    if (!context.anonymizedPackageReady) failed.push('anonymizedPackageReady');
  }
  if (to === 'REVISION_SUBMITTED' && !context.revisionVersionCreated) {
    failed.push('revisionVersionCreated');
  }
  if (decisionTargets.has(to)) {
    if (!context.decisionBasis?.trim()) failed.push('decisionBasis');
    if (!context.publicReason?.trim()) failed.push('publicReason');
    if (context.decisionRequiresCompletedReviews && !context.requiredReviewsComplete) {
      failed.push('requiredReviewsComplete');
    }
    if (!actor.stepUpVerified) failed.push('stepUpVerified');
    if (
      context.fourEyesRequired &&
      (!context.decisionPreparedBy || context.decisionPreparedBy === actor.id)
    ) {
      failed.push('fourEyesApproval');
    }
  }
  if (to === 'PUBLISHED' && !context.publicationReference?.trim()) {
    failed.push('publicationReference');
  }
  return failed;
}

export function assertTransitionAllowed(
  from: SubmissionStatus,
  to: SubmissionStatus,
  actor: ScopedActor,
  context: TransitionGuardContext,
): void {
  if (!(allowedTransitions[from] as readonly SubmissionStatus[]).includes(to)) {
    throw new TransitionDeniedError('INVALID_TRANSITION', [`${from}->${to}`]);
  }

  const permission = requiredPermission(to, actor.role);
  if (permission && !hasPermission(actor.role, permission)) {
    throw new TransitionDeniedError('FORBIDDEN', [permission]);
  }

  const isAuthorOwnedAction = actor.role === 'AUTHOR' && actor.id === context.ownerId;
  if (!isAuthorOwnedAction && !hasJournalScope(actor, context.journalId)) {
    throw new TransitionDeniedError('OUT_OF_SCOPE', [context.journalId]);
  }

  if (actor.role === 'AUTHOR' && actor.id !== context.ownerId) {
    throw new TransitionDeniedError('FORBIDDEN', ['ownership']);
  }

  const failures = collectGuardFailures(from, to, actor, context);
  if (failures.length > 0) throw new TransitionDeniedError('GUARD_FAILED', failures);
}
