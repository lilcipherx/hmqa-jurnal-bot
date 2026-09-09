import { translate, type TranslationKey } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { ResourceTable } from '../../../components/resource-table';
import { TranslationManager } from '../../../components/translation-manager';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';
interface Translation {
  id: string;
  key: string;
  namespace: string;
  versions: { id: string; locale: string; version: number; state: string }[];
}
export default async function TranslationsPage() {
  const locale = await currentLocale();
  const data = await adminFetch<{ items: Translation[] }>('/api/v1/admin/translations');
  return (
    <>
      <PageHeader title={translate(locale, 'admin.translations.heading')} />
      <ResourceTable
        caption={translate(locale, 'admin.translations.heading')}
        headers={[
          translate(locale, 'admin.table.key'),
          translate(locale, 'admin.table.version'),
          translate(locale, 'admin.table.status'),
        ]}
        empty={translate(locale, 'admin.table.empty')}
        rows={data.items.map((item) => [
          <span className="identifier">{item.key}</span>,
          item.versions.map((entry) => `${entry.locale}:v${entry.version}`).join(' · ') || '—',
          item.versions
            .map((entry) =>
              translate(locale, `publication_state.${entry.state.toLowerCase()}` as TranslationKey),
            )
            .join(', ') || '—',
        ])}
      />
      <TranslationManager
        versions={data.items.flatMap((item) =>
          item.versions.map((version) => ({ ...version, key: item.key })),
        )}
        stateLabels={Object.fromEntries(
          ['DRAFT', 'REVIEW', 'APPROVED', 'PUBLISHED', 'RETIRED'].map((state) => [
            state,
            translate(locale, `publication_state.${state.toLowerCase()}` as TranslationKey),
          ]),
        )}
        labels={{
          create: translate(locale, 'admin.translations.create'),
          key: translate(locale, 'admin.table.key'),
          namespace: translate(locale, 'admin.translations.namespace'),
          description: translate(locale, 'admin.translations.description'),
          locale: translate(locale, 'admin.table.locale'),
          message: translate(locale, 'admin.translations.message'),
          save: translate(locale, 'admin.action.save'),
          lifecycle: translate(locale, 'admin.translations.lifecycle'),
          advance: translate(locale, 'admin.translations.advance'),
        }}
      />
    </>
  );
}
