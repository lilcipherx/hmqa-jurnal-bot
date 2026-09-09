import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { JournalManager } from '../../../components/journal-manager';
import { adminFetch, type CurrentEmployee } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

interface Journal {
  id: string;
  code: string;
  mode: string;
  active: boolean;
  externalUrl: string | null;
  fourEyesRequired: boolean;
  acceptanceOpensAt: string | null;
  acceptanceClosesAt: string | null;
  updatedAt: string;
  localizations: {
    locale: string;
    name: string;
    shortName: string;
    description: string;
    contactText: string | null;
  }[];
  currentRequirement: { version: number; state: string } | null;
  _count: { submissions: number; requirementVersions: number };
  requirementVersions: { id: string; version: number; state: string; rowVersion: number }[];
}
export default async function JournalsPage() {
  const locale = await currentLocale();
  const [data, employee] = await Promise.all([
    adminFetch<{ items: Journal[] }>('/api/v1/admin/journals'),
    adminFetch<CurrentEmployee>('/api/v1/auth/me'),
  ]);
  return (
    <>
      <PageHeader title={translate(locale, 'admin.journals.heading')} />
      <ResourceTable
        caption={translate(locale, 'admin.journals.heading')}
        headers={[
          translate(locale, 'admin.journals.code'),
          translate(locale, 'admin.table.name'),
          translate(locale, 'admin.table.mode'),
          translate(locale, 'admin.table.requirements'),
          translate(locale, 'admin.metric.total'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          <span className="identifier">{item.code}</span>,
          item.localizations.find(
            (entry) => entry.locale === (locale === 'uz-Latn' ? 'uz_Latn' : locale),
          )?.name ?? item.code,
          <span className="badge">
            {translate(locale, `journal_mode.${item.mode.toLowerCase()}` as TranslationKey)}
          </span>,
          item.currentRequirement
            ? `v${item.currentRequirement.version} · ${translate(
                locale,
                `publication_state.${item.currentRequirement.state.toLowerCase()}` as TranslationKey,
              )}`
            : '—',
          item._count.submissions.toLocaleString(locale),
        ])}
      />
      {employee.permissions.includes('journal:configure') ? (
        <JournalManager
          journals={data.items}
          modeLabels={Object.fromEntries(
            ['NATIVE', 'CLOSED', 'EXTERNAL_LINK', 'API_SYNC', 'ARCHIVED'].map((mode) => [
              mode,
              translate(locale, `journal_mode.${mode.toLowerCase()}` as TranslationKey),
            ]),
          )}
          stateLabels={Object.fromEntries(
            ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED'].map((state) => [
              state,
              translate(locale, `publication_state.${state.toLowerCase()}` as TranslationKey),
            ]),
          )}
          labels={{
            createJournal: translate(locale, 'admin.journals.create'),
            editJournal: translate(locale, 'admin.journals.edit'),
            createRequirement: translate(locale, 'admin.journals.create_requirement'),
            code: translate(locale, 'admin.journals.code'),
            mode: translate(locale, 'admin.table.mode'),
            externalUrl: translate(locale, 'admin.journals.external_url'),
            name: translate(locale, 'admin.table.name'),
            shortName: translate(locale, 'admin.journals.short_name'),
            description: translate(locale, 'admin.journals.description'),
            contact: translate(locale, 'admin.journals.contact'),
            journal: translate(locale, 'admin.table.journal'),
            changeNote: translate(locale, 'admin.journals.change_note'),
            config: translate(locale, 'admin.journals.config'),
            title: translate(locale, 'submission.preview.title'),
            summary: translate(locale, 'admin.journals.summary'),
            body: translate(locale, 'admin.journals.body'),
            create: translate(locale, 'admin.action.create'),
            lifecycle: translate(locale, 'admin.translations.lifecycle'),
            advance: translate(locale, 'admin.translations.advance'),
            invalidJson: translate(locale, 'admin.journals.invalid_json'),
            open: translate(locale, 'admin.journals.open'),
            close: translate(locale, 'admin.journals.close'),
            acceptanceOpens: translate(locale, 'admin.journals.acceptance_opens'),
            acceptanceCloses: translate(locale, 'admin.journals.acceptance_closes'),
            fourEyes: translate(locale, 'admin.journals.four_eyes'),
            active: translate(locale, 'admin.journals.active'),
            save: translate(locale, 'admin.action.save'),
          }}
        />
      ) : null}
    </>
  );
}
