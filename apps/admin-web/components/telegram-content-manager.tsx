'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

type PublicLocale = 'uz-Latn' | 'ru' | 'en';
interface ContactRecord {
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
}

function value(form: FormData, name: string): string | null {
  const entry = form.get(name);
  return typeof entry === 'string' && entry.trim() ? entry.trim() : null;
}

export function TelegramContentManager({
  contacts,
  content,
  allowedContentKeys,
  journals,
  labels,
}: {
  contacts: ContactRecord[];
  content: { key: string; locale: PublicLocale; content: string }[];
  allowedContentKeys: string[];
  journals: { id: string; code: string }[];
  labels: Record<string, string>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function saveContact(event: FormEvent<HTMLFormElement>, identity: string) {
    event.preventDefault();
    setBusy(identity);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/telegram-content/contact', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journalId: value(form, 'journalId'),
        phone: value(form, 'phone'),
        email: value(form, 'email'),
        telegram: value(form, 'telegram'),
        localizations: (['uz-Latn', 'ru', 'en'] as const).map((locale) => ({
          locale,
          address: value(form, `address:${locale}`),
          workingHours: value(form, `workingHours:${locale}`),
          note: value(form, `note:${locale}`),
        })),
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setError(await localizedResponseError(response));
      setBusy('');
    }
  }

  async function saveContent(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault();
    setBusy(key);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/telegram-content/items/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        uzLatn: value(form, 'uz-Latn'),
        ru: value(form, 'ru'),
        en: value(form, 'en'),
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setError(await localizedResponseError(response));
      setBusy('');
    }
  }

  const localization = (contact: ContactRecord | undefined, locale: PublicLocale) =>
    contact?.localizations.find((item) => item.locale === locale);
  const contactEditor = (contact: ContactRecord | undefined, identity: string, isNew = false) => (
    <form
      className="panel form-stack"
      data-testid={`contact-${identity}`}
      onSubmit={(event) => void saveContact(event, identity)}
      aria-busy={busy === identity}
    >
      <h3>{contact?.journal?.code ?? (isNew ? labels.journalOverride : labels.globalContact)}</h3>
      {isNew ? (
        <label className="field">
          {labels.journal}
          <select name="journalId" required defaultValue="">
            <option value="" disabled>
              {labels.chooseJournal}
            </option>
            {journals
              .filter((journal) => !contacts.some((item) => item.journalId === journal.id))
              .map((journal) => (
                <option key={journal.id} value={journal.id}>
                  {journal.code}
                </option>
              ))}
          </select>
        </label>
      ) : contact?.journalId ? (
        <input type="hidden" name="journalId" value={contact.journalId} />
      ) : null}
      <div className="form-grid">
        <label className="field">
          {labels.phone}
          <input name="phone" type="tel" defaultValue={contact?.phone ?? ''} />
        </label>
        <label className="field">
          {labels.email}
          <input name="email" type="email" defaultValue={contact?.email ?? ''} />
        </label>
        <label className="field">
          {labels.telegram}
          <input name="telegram" defaultValue={contact?.telegram ?? ''} placeholder="@username" />
        </label>
      </div>
      {(['uz-Latn', 'ru', 'en'] as const).map((locale) => (
        <fieldset className="localized-fields" key={locale}>
          <legend>{locale}</legend>
          <label className="field">
            {labels.address}
            <textarea
              name={`address:${locale}`}
              defaultValue={localization(contact, locale)?.address ?? ''}
            />
          </label>
          <label className="field">
            {labels.hours}
            <textarea
              name={`workingHours:${locale}`}
              defaultValue={localization(contact, locale)?.workingHours ?? ''}
            />
          </label>
          <label className="field">
            {labels.note}
            <textarea
              name={`note:${locale}`}
              defaultValue={localization(contact, locale)?.note ?? ''}
            />
          </label>
        </fieldset>
      ))}
      <button className="button" type="submit" disabled={Boolean(busy)}>
        {labels.save}
      </button>
    </form>
  );

  return (
    <>
      <section>
        <h2>{labels.contacts}</h2>
        <p className="lede">{labels.contactsDescription}</p>
        {contactEditor(
          contacts.find((contact) => contact.scopeKey === 'GLOBAL'),
          'GLOBAL',
        )}
        {contacts
          .filter((contact) => contact.journalId)
          .map((contact) => (
            <div key={contact.id}>{contactEditor(contact, contact.id)}</div>
          ))}
        {journals.some((journal) => !contacts.some((item) => item.journalId === journal.id))
          ? contactEditor(undefined, 'NEW', true)
          : null}
      </section>
      <section className="section-block">
        <h2>{labels.helpContent}</h2>
        <p className="lede">{labels.helpDescription}</p>
        <div className="card-grid">
          {allowedContentKeys.map((key) => (
            <form
              className="panel form-stack"
              data-testid={`bot-content-${key}`}
              key={key}
              onSubmit={(event) => void saveContent(event, key)}
            >
              <h3>{labels[key] ?? key}</h3>
              {(['uz-Latn', 'ru', 'en'] as const).map((locale) => (
                <label className="field" key={locale}>
                  {locale}
                  <textarea
                    name={locale}
                    required
                    maxLength={10_000}
                    defaultValue={
                      content.find((item) => item.key === key && item.locale === locale)?.content ??
                      ''
                    }
                  />
                </label>
              ))}
              <button className="button" type="submit" disabled={Boolean(busy)}>
                {labels.save}
              </button>
            </form>
          ))}
        </div>
      </section>
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
    </>
  );
}
