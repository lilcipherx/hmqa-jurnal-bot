import { describe, expect, it } from 'vitest';
import {
  hasJournalScope,
  hasPermission,
  permissions,
  permissionsFor,
  roles,
} from './permissions.js';

describe('simplified permission model', () => {
  it('defines authors and exactly one staff role', () => {
    expect(roles).toEqual(['AUTHOR', 'ADMIN']);
  });

  it('grants every product permission to every administrator account', () => {
    expect([...permissionsFor('ADMIN')].sort()).toEqual([...permissions].sort());
    for (const permission of permissions) expect(hasPermission('ADMIN', permission)).toBe(true);
  });

  it('keeps authors limited to their own author workflow', () => {
    expect(permissionsFor('AUTHOR')).toEqual([
      'profile:read:self',
      'profile:update:self',
      'submission:create:self',
      'submission:read:self',
      'submission:withdraw:self',
      'file:read:self',
      'journal:read',
    ]);
    expect(hasPermission('AUTHOR', 'submission:decision:approve')).toBe(false);
    expect(hasPermission('AUTHOR', 'user:manage')).toBe(false);
  });

  it('gives every administrator global journal scope', () => {
    const admin = {
      id: 'admin-1',
      role: 'ADMIN' as const,
      journalIds: new Set<string>(),
      stepUpVerified: false,
    };
    expect(hasJournalScope(admin, 'journal-a')).toBe(true);
    expect(hasJournalScope(admin, 'journal-b')).toBe(true);
  });
});
