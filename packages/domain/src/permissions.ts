export const roles = ['AUTHOR', 'ADMIN'] as const;

export type Role = (typeof roles)[number];

export const permissions = [
  'profile:read:self',
  'profile:update:self',
  'submission:create:self',
  'submission:read:self',
  'submission:withdraw:self',
  'submission:read:journal',
  'submission:assign',
  'submission:technical-review',
  'submission:editorial-review',
  'submission:decision:prepare',
  'submission:decision:approve',
  'submission:publish',
  'review:read:assigned',
  'review:write:assigned',
  'review:assign',
  'file:read:self',
  'file:read:journal',
  'file:read:anonymized',
  'journal:read',
  'journal:configure',
  'journal:approve',
  'translation:configure',
  'user:manage',
  'role:manage',
  'pii:reveal',
  'export:create',
  'audit:read:journal',
  'audit:read:all',
  'operations:read',
  'notification:replay',
  'privacy:case:read',
  'privacy:case:manage',
  'retention:hold:manage',
] as const;

export type Permission = (typeof permissions)[number];

const matrix: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  AUTHOR: new Set([
    'profile:read:self',
    'profile:update:self',
    'submission:create:self',
    'submission:read:self',
    'submission:withdraw:self',
    'file:read:self',
    'journal:read',
  ]),
  ADMIN: new Set(permissions),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return matrix[role].has(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return [...matrix[role]];
}

export interface ScopedActor {
  readonly id: string;
  readonly role: Role;
  readonly journalIds: ReadonlySet<string>;
  readonly stepUpVerified: boolean;
}

export function hasJournalScope(actor: ScopedActor, journalId: string): boolean {
  return actor.role === 'ADMIN' || actor.journalIds.has(journalId);
}
