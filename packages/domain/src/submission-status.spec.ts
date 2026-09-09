import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  assertTransitionAllowed,
  legacyStatusAliases,
  normalizeSubmissionStatus,
  submissionStatuses,
  TransitionDeniedError,
  type SubmissionStatus,
} from './submission-status.js';
import type { ScopedActor } from './permissions.js';

const author = {
  id: 'author-1',
  role: 'AUTHOR' as const,
  journalIds: new Set<string>(),
  stepUpVerified: false,
};

const journalId = 'journal-1';
const ownerId = author.id;

function actorFor(target: SubmissionStatus): ScopedActor {
  if (target === 'SUBMITTED' || target === 'REVISION_SUBMITTED' || target === 'WITHDRAWN') {
    return author;
  }
  return {
    id: 'admin-1',
    role: 'ADMIN',
    journalIds: new Set<string>(),
    stepUpVerified: true,
  };
}

function completeContext() {
  return {
    journalId,
    ownerId,
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
    publicReason: 'Complete public reason',
    deadline: new Date(Date.now() + 86_400_000),
    revisionVersionCreated: true,
    decisionBasis: 'Complete internal decision basis',
    fourEyesRequired: false,
    publicationReference: 'VOL-2026-001',
  };
}

describe('submission workflow', () => {
  it('defines every status exactly once in the transition table', () => {
    expect(Object.keys(allowedTransitions).sort()).toEqual([...submissionStatuses].sort());
  });

  for (const from of submissionStatuses) {
    it(`allows every whitelisted transition from ${from}`, () => {
      for (const to of allowedTransitions[from]) {
        expect(() =>
          assertTransitionAllowed(from, to, actorFor(to), completeContext()),
        ).not.toThrow();
      }
    });

    it(`rejects every non-whitelisted transition from ${from}`, () => {
      const forbiddenTargets = submissionStatuses.filter(
        (target) => !(allowedTransitions[from] as readonly SubmissionStatus[]).includes(target),
      );
      for (const to of forbiddenTargets) {
        try {
          assertTransitionAllowed(from, to, actorFor(to), completeContext());
          throw new Error(`EXPECTED_INVALID_TRANSITION:${from}->${to}`);
        } catch (error) {
          expect(error).toBeInstanceOf(TransitionDeniedError);
          if (error instanceof TransitionDeniedError) expect(error.code).toBe('INVALID_TRANSITION');
        }
      }
    });
  }

  it('checks backend permissions for every staff-only whitelisted transition', () => {
    for (const from of submissionStatuses) {
      for (const to of allowedTransitions[from]) {
        if (to === 'SUBMITTED' || to === 'REVISION_SUBMITTED' || to === 'WITHDRAWN') continue;
        expect(() => assertTransitionAllowed(from, to, author, completeContext())).toThrowError(
          TransitionDeniedError,
        );
      }
    }
  });

  it('rejects direct acceptance from both technical receipt states', () => {
    const chief = actorFor('ACCEPTED');
    expect(() =>
      assertTransitionAllowed('SUBMITTED', 'ACCEPTED', chief, completeContext()),
    ).toThrowError(new TransitionDeniedError('INVALID_TRANSITION', ['SUBMITTED->ACCEPTED']));
    expect(() =>
      assertTransitionAllowed('REGISTERED', 'ACCEPTED', chief, completeContext()),
    ).toThrowError(new TransitionDeniedError('INVALID_TRANSITION', ['REGISTERED->ACCEPTED']));
  });

  it('normalizes legacy names without creating persisted parallel states', () => {
    expect(normalizeSubmissionStatus('AUTO_CHECK')).toBe('TECHNICAL_REVIEW');
    expect(normalizeSubmissionStatus('NEEDS_FIX')).toBe('NEEDS_CORRECTION');
    expect(normalizeSubmissionStatus('EDITORIAL_SCREENING')).toBe('EDITORIAL_REVIEW');
    expect(
      Object.values(legacyStatusAliases).every((value) => submissionStatuses.includes(value)),
    ).toBe(true);
  });

  it('allows a complete author submission', () => {
    expect(() =>
      assertTransitionAllowed('DRAFT', 'SUBMITTED', author, {
        journalId: 'journal-1',
        ownerId: author.id,
        requiredFieldsComplete: true,
        activeConsent: true,
        mandatoryFilesClean: true,
        blockingPreflightCount: 0,
        authorConfirmed: true,
      }),
    ).not.toThrow();
  });

  it('rejects a submission with a scanner or preflight blocker', () => {
    expect(() =>
      assertTransitionAllowed('DRAFT', 'SUBMITTED', author, {
        journalId: 'journal-1',
        ownerId: author.id,
        requiredFieldsComplete: true,
        activeConsent: true,
        mandatoryFilesClean: false,
        blockingPreflightCount: 1,
        authorConfirmed: true,
      }),
    ).toThrowError(TransitionDeniedError);
  });

  it('never permits submitted to accepted directly', () => {
    expect(() =>
      assertTransitionAllowed('SUBMITTED', 'ACCEPTED', author, {
        journalId: 'journal-1',
        ownerId: author.id,
      }),
    ).toThrowError(new TransitionDeniedError('INVALID_TRANSITION', ['SUBMITTED->ACCEPTED']));
  });

  it('requires a different step-up actor for four-eyes acceptance', () => {
    const admin = {
      id: 'admin-1',
      role: 'ADMIN' as const,
      journalIds: new Set<string>(),
      stepUpVerified: true,
    };
    try {
      assertTransitionAllowed('UNDER_REVIEW', 'ACCEPTED', admin, {
        journalId: 'journal-1',
        ownerId: author.id,
        decisionBasis: 'reviews-complete',
        publicReason: 'Approved by the editorial board',
        fourEyesRequired: true,
        decisionPreparedBy: admin.id,
      });
      throw new Error('EXPECTED_TRANSITION_DENIAL');
    } catch (error) {
      expect(error).toBeInstanceOf(TransitionDeniedError);
      if (error instanceof TransitionDeniedError) expect(error.code).toBe('GUARD_FAILED');
    }
  });

  it('lets an administrator execute an accept decision when the guards pass', () => {
    const admin = {
      id: 'admin-1',
      role: 'ADMIN' as const,
      journalIds: new Set<string>(),
      stepUpVerified: true,
    };
    expect(() =>
      assertTransitionAllowed('UNDER_REVIEW', 'ACCEPTED', admin, {
        journalId: 'journal-1',
        ownerId: author.id,
        decisionBasis: 'reviewed',
        publicReason: 'Approved',
        fourEyesRequired: false,
      }),
    ).not.toThrow();
  });

  it('enforces completed reviews when the journal policy requires them', () => {
    const admin = {
      id: 'admin-1',
      role: 'ADMIN' as const,
      journalIds: new Set<string>(),
      stepUpVerified: true,
    };
    expect(() =>
      assertTransitionAllowed('UNDER_REVIEW', 'ACCEPTED', admin, {
        journalId: 'journal-1',
        ownerId: author.id,
        decisionBasis: 'reviewed',
        publicReason: 'Decision text',
        fourEyesRequired: false,
        decisionRequiresCompletedReviews: true,
        requiredReviewsComplete: false,
      }),
    ).toThrowError(TransitionDeniedError);
  });
});
