import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), 'apps/admin-web');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('simplified Admin Panel product model', () => {
  it('shows the approved eight-section navigation without privacy, audit, or roles', () => {
    const layout = source('app/(admin)/layout.tsx');
    for (const route of [
      '/dashboard',
      '/submissions',
      '/journals',
      '/reviewers',
      '/telegram',
      '/notifications',
      '/users',
      '/settings',
    ]) {
      expect(layout).toContain(`'${route}'`);
    }
    expect(layout).not.toContain("'/audit'");
    expect(layout).not.toContain("'/privacy'");
    expect(layout).not.toContain("'/roles'");
  });

  it('has no role or journal-scope selector in administrator invitation/management', () => {
    const invitation = source('components/employee-invite-form.tsx');
    const administrators = source('app/(admin)/users/page.tsx');
    expect(invitation).not.toMatch(/name=["']roles?["']/i);
    expect(invitation).not.toMatch(/journalIds/);
    expect(administrators).not.toMatch(/EmployeeAccessForms|roleLabels|journalScopes/);
  });

  it('keeps the selected locale while switching from the current protected route', () => {
    const switcher = source('components/language-switcher.tsx');
    expect(switcher).toContain('usePathname');
    expect(switcher).toContain('encodeURIComponent(pathname)');
    expect(switcher).toContain("['uz-Latn', 'UZ']");
    expect(switcher).toContain("['ru', 'RU']");
    expect(switcher).toContain("['en', 'EN']");
  });

  it('does not expose deprecated Telegram privacy commands or profile fields', () => {
    const bot = source('../bot/src/bot.ts');
    expect(bot).not.toContain("bot.command('privacy'");
    expect(bot).not.toMatch(/AUTHOR_(COUNTRY|CITY|ORCID)|PROFILE_(COUNTRY|CITY|ORCID)/);
    expect(bot).toContain('profile-choice:degree');
    expect(bot).toContain('profile-choice:title');
    expect(bot).toContain('contact:journal:');
  });

  it('provides structured requirement editing, preview, and optimistic updates', () => {
    const journals = source('components/journal-manager.tsx');
    expect(journals).toContain('updateRequirement');
    expect(journals).toContain('/api/requirements/${requirement.id}');
    expect(journals).toContain('expectedRowVersion');
    expect(journals).toContain('journalRequirementConfigSchema.safeParse');
    expect(journals).toContain('requirementPreview');
    expect(journals).not.toMatch(/name=["'][^"']*json/i);
  });

  it('makes journal creation an explicit action with understandable sections', () => {
    const journals = source('components/journal-manager.tsx');
    expect(journals).toContain('showCreateJournal');
    expect(journals).toContain('aria-expanded={showCreateJournal}');
    expect(journals).toContain('labels.basicInfo');
    expect(journals).toContain('labels.localizedContent');
    expect(journals).toContain('labels.submissionSettings');
    expect(journals).toContain('labels.datesAndDeadlines');
  });
});
