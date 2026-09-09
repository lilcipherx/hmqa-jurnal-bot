export const privacyRequestStatuses = [
  'RECEIVED',
  'IDENTITY_VERIFICATION',
  'IN_REVIEW',
  'APPROVED',
  'DENIED',
  'EXECUTING',
  'COMPLETED',
  'CANCELLED',
] as const;

export type PrivacyRequestStatus = (typeof privacyRequestStatuses)[number];

export const privacyRequestTransitions: Readonly<
  Record<PrivacyRequestStatus, readonly PrivacyRequestStatus[]>
> = {
  RECEIVED: ['IDENTITY_VERIFICATION', 'CANCELLED'],
  IDENTITY_VERIFICATION: ['IN_REVIEW', 'DENIED', 'CANCELLED'],
  IN_REVIEW: ['APPROVED', 'DENIED', 'CANCELLED'],
  APPROVED: ['EXECUTING'],
  DENIED: [],
  EXECUTING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionPrivacyRequest(
  from: PrivacyRequestStatus,
  to: PrivacyRequestStatus,
): boolean {
  return privacyRequestTransitions[from].includes(to);
}
