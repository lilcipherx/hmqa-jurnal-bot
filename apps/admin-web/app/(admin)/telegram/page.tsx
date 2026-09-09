import { translate } from '@hmqa/i18n';
import { PageHeader } from '../../../components/page-header';
import { TelegramContentManager } from '../../../components/telegram-content-manager';
import { adminFetch } from '../../../lib/api';
import { currentLocale } from '../../../lib/locale';

type PublicLocale = 'uz-Latn' | 'ru' | 'en';
interface TelegramContent {
  contacts: {
    id: string;
    scopeKey: string;
    journalId: string | null;
    phone: string | null;
    email: string | null;
    telegram: string | null;
    journal: { id: string; code: string } | null;
    localizations: {
      locale: PublicLocale;
      address: string | null;
      workingHours: string | null;
      note: string | null;
    }[];
  }[];
  content: { key: string; locale: PublicLocale; content: string }[];
  allowedContentKeys: string[];
}

export default async function TelegramPage() {
  const locale = await currentLocale();
  const [data, journals] = await Promise.all([
    adminFetch<TelegramContent>('/api/v1/admin/telegram-content'),
    adminFetch<{ items: { id: string; code: string }[] }>('/api/v1/admin/journals'),
  ]);
  return (
    <>
      <PageHeader
        title={translate(locale, 'admin.telegram.heading')}
        description={translate(locale, 'admin.telegram.description')}
      />
      <TelegramContentManager
        {...data}
        journals={journals.items}
        labels={{
          contacts: translate(locale, 'admin.telegram.contacts'),
          contactsDescription: translate(locale, 'admin.telegram.contacts_description'),
          globalContact: translate(locale, 'admin.telegram.global_contact'),
          journalOverride: translate(locale, 'admin.telegram.journal_override'),
          journal: translate(locale, 'admin.table.journal'),
          chooseJournal: translate(locale, 'admin.telegram.choose_journal'),
          phone: translate(locale, 'contact.phone'),
          email: translate(locale, 'contact.email'),
          telegram: translate(locale, 'contact.telegram'),
          address: translate(locale, 'contact.address'),
          hours: translate(locale, 'contact.hours'),
          note: translate(locale, 'admin.telegram.note'),
          helpContent: translate(locale, 'admin.telegram.help_content'),
          helpDescription: translate(locale, 'admin.telegram.help_description'),
          save: translate(locale, 'admin.action.save'),
          WELCOME_SUPPORT: translate(locale, 'admin.telegram.content.welcome'),
          HELP_SUBMIT: translate(locale, 'help.submit.label'),
          HELP_FILES: translate(locale, 'help.files.label'),
          HELP_STATUSES: translate(locale, 'help.statuses.label'),
          HELP_REVISION: translate(locale, 'help.revision.label'),
          HELP_CONTACT: translate(locale, 'help.contact.label'),
        }}
      />
    </>
  );
}
