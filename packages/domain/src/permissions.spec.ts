import { describe, expect, it } from 'vitest';
import {
  hasJournalScope,
  hasPermission,
  permissions,
  permissionsFor,
  roles,
  type Permission,
  type Role,
} from './permissions.js';

const expectedMatrix = {
  AUTHOR: [
    'profile:read:self',
    'profile:update:self',
    'submission:create:self',
    'submission:read:self',
    'submission:withdraw:self',
    'file:read:self',
    'journal:read',
  ],
  OPERATOR: [
    'submission:read:journal',
    'submission:assign',
    'submission:technical-review',
    'file:read:journal',
    'journal:read',
    'pii:reveal',
    'audit:read:journal',
    'notification:replay',
  ],
  EDITOR: [
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
  ],
  REVIEWER: [
    'review:read:assigned',
    'review:write:assigned',
    'file:read:anonymized',
    'journal:read',
  ],
  CHIEF_EDITOR: [
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
  ],
  CONTENT_ADMIN: [
    'journal:read',
    'journal:configure',
    'translation:configure',
    'audit:read:journal',
  ],
  ADMIN: [
    'journal:read',
    'user:manage',
    'role:manage',
    'audit:read:all',
    'operations:read',
    'notification:replay',
    'privacy:case:read',
    'privacy:case:manage',
    'retention:hold:manage',
  ],
  AUDITOR: [
    'journal:read',
    'audit:read:all',
    'operations:read',
    'export:create',
    'privacy:case:read',
  ],
} as const satisfies Record<Role, readonly Permission[]>;

describe('permission matrix', () => {
  it('defines the mandatory roles', () => {
    expect(roles).toEqual(
      expect.arrayContaining([
        'AUTHOR',
        'OPERATOR',
        'EDITOR',
        'REVIEWER',
        'CHIEF_EDITOR',
        'ADMIN',
        'AUDITOR',
      ]),
    );
  });

  it('matches the exact reviewed allow-list for every role and permission', () => {
    for (const role of roles) {
      const expected = new Set<Permission>(expectedMatrix[role]);
      expect([...permissionsFor(role)].sort()).toEqual([...expectedMatrix[role]].sort());
      for (const permission of permissions) {
        expect(hasPermission(role, permission), `${role}:${permission}`).toBe(
          expected.has(permission),
        );
      }
    }
  });

  it('enforces journal scope except for global audit/administration roles', () => {
    for (const role of roles) {
      const actor = {
        id: `${role.toLowerCase()}-1`,
        role,
        journalIds: new Set(['journal-a']),
        stepUpVerified: false,
      };
      expect(hasJournalScope(actor, 'journal-a')).toBe(true);
      expect(hasJournalScope(actor, 'journal-b')).toBe(role === 'ADMIN' || role === 'AUDITOR');
    }
  });

  it('does not allow operators to accept or reject', () => {
    expect(hasPermission('OPERATOR', 'submission:decision:approve')).toBe(false);
  });

  it('does not grant ordinary admins manuscript access', () => {
    expect(hasPermission('ADMIN', 'file:read:journal')).toBe(false);
  });

  it('separates privacy case oversight from destructive retention authority', () => {
    expect(hasPermission('AUDITOR', 'privacy:case:read')).toBe(true);
    expect(hasPermission('AUDITOR', 'privacy:case:manage')).toBe(false);
    expect(hasPermission('ADMIN', 'retention:hold:manage')).toBe(true);
    expect(hasPermission('EDITOR', 'retention:hold:manage')).toBe(false);
  });
});
