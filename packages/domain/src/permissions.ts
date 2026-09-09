export const roles = [
  'AUTHOR',
  'OPERATOR',
  'EDITOR',
  'REVIEWER',
  'CHIEF_EDITOR',
  'CONTENT_ADMIN',
  'ADMIN',
  'AUDITOR',
] as const;

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
  OPERATOR: new Set([
    'submission:read:journal',
    'submission:assign',
    'submission:technical-review',
    'file:read:journal',
    'journal:read',
    'pii:reveal',
    'audit:read:journal',
    'notification:replay',
  ]),
  EDITOR: new Set([
    'submission:read:journal',
    'submission:assign',
    'submission:technical-review',
    'submission:editorial-review',
    'submission:decision:prepare',
    'review:assign',
    'file:read:journal',
    'journal:read',
    'journal:approve',
    'audit:read:journal',
    'pii:reveal',
  ]),
  REVIEWER: new Set([
    'review:read:assigned',
    'review:write:assigned',
    'file:read:anonymized',
    'journal:read',
  ]),
  CHIEF_EDITOR: new Set([
    'submission:read:journal',
    'submission:assign',
    'submission:technical-review',
    'submission:editorial-review',
    'submission:decision:prepare',
    'submission:decision:approve',
    'submission:publish',
    'review:assign',
    'file:read:journal',
    'journal:read',
    'journal:approve',
    'pii:reveal',
    'export:create',
    'audit:read:journal',
    'notification:replay',
  ]),
  CONTENT_ADMIN: new Set([
    'journal:read',
    'journal:configure',
    'translation:configure',
    'audit:read:journal',
  ]),
  ADMIN: new Set([
    'journal:read',
    'user:manage',
    'role:manage',
    'audit:read:all',
    'operations:read',
    'notification:replay',
    'privacy:case:read',
    'privacy:case:manage',
    'retention:hold:manage',
  ]),
  AUDITOR: new Set([
    'journal:read',
    'audit:read:all',
    'operations:read',
    'export:create',
    'privacy:case:read',
  ]),
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
  return actor.role === 'ADMIN' || actor.role === 'AUDITOR' || actor.journalIds.has(journalId);
}
