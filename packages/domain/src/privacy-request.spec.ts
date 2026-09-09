import { describe, expect, it } from 'vitest';
import { canTransitionPrivacyRequest, privacyRequestTransitions } from './privacy-request.js';

describe('privacy request state machine', () => {
  it('requires identity verification and review before approval', () => {
    expect(canTransitionPrivacyRequest('RECEIVED', 'APPROVED')).toBe(false);
    expect(canTransitionPrivacyRequest('RECEIVED', 'IDENTITY_VERIFICATION')).toBe(true);
    expect(canTransitionPrivacyRequest('IDENTITY_VERIFICATION', 'IN_REVIEW')).toBe(true);
    expect(canTransitionPrivacyRequest('IN_REVIEW', 'APPROVED')).toBe(true);
  });

  it('does not reopen or silently change terminal cases', () => {
    expect(privacyRequestTransitions.COMPLETED).toEqual([]);
    expect(privacyRequestTransitions.DENIED).toEqual([]);
    expect(privacyRequestTransitions.CANCELLED).toEqual([]);
  });
});
