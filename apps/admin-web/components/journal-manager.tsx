'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

interface JournalOption {
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
  requirementVersions: { id: string; version: number; state: string; rowVersion: number }[];
}

export function JournalManager({
  journals,
  labels,
  modeLabels,
  stateLabels,
}: {
  journals: JournalOption[];
  labels: Record<string, string>;
  modeLabels: Record<string, string>;
  stateLabels: Record<string, string>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function send(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setMessage('');
    const response = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy(false);
    }
  }
  async function createJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localized = (suffix: string) => ({
      name: form.get(`name_${suffix}`),
      shortName: form.get(`short_${suffix}`),
      description: form.get(`description_${suffix}`),
      contactText: form.get(`contact_${suffix}`) || undefined,
    });
    await send('/api/journals', {
      code: form.get('code'),
      mode: form.get('mode'),
      externalUrl: form.get('externalUrl') || undefined,
      fourEyesRequired: true,
      localizations: { 'uz-Latn': localized('uz'), ru: localized('ru'), en: localized('en') },
    });
  }
  async function createRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let config: unknown;
    try {
      config = JSON.parse(text(form, 'config'));
    } catch {
      setMessage(labels.invalidJson ?? '');
      return;
    }
    const localized = (suffix: string) => ({
      title: form.get(`title_${suffix}`),
      summary: form.get(`summary_${suffix}`),
      body: form.get(`body_${suffix}`),
    });
    await send(`/api/journals/${text(form, 'journalId')}/requirements`, {
      config,
      changeNote: form.get('changeNote'),
      localizations: { 'uz-Latn': localized('uz'), ru: localized('ru'), en: localized('en') },
    });
  }
  async function updateJournal(event: FormEvent<HTMLFormElement>, journal: JournalOption) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const localized = (suffix: string) => ({
      name: form.get(`edit_name_${suffix}`),
      shortName: form.get(`edit_short_${suffix}`),
      description: form.get(`edit_description_${suffix}`),
      contactText: form.get(`edit_contact_${suffix}`) || null,
    });
    await send(
      `/api/journals/${journal.id}`,
      {
        mode: form.get('edit_mode'),
        externalUrl: form.get('edit_external_url') || null,
        active: form.get('edit_active') === 'on',
        fourEyesRequired: form.get('edit_four_eyes') === 'on',
        acceptanceOpensAt: text(form, 'edit_acceptance_opens')
          ? new Date(text(form, 'edit_acceptance_opens')).toISOString()
          : null,
        acceptanceClosesAt: text(form, 'edit_acceptance_closes')
          ? new Date(text(form, 'edit_acceptance_closes')).toISOString()
          : null,
        localizations: {
          'uz-Latn': localized('uz'),
          ru: localized('ru'),
          en: localized('en'),
        },
        expectedUpdatedAt: journal.updatedAt,
      },
      'PATCH',
    );
  }
  const next: Record<string, string> = {
    DRAFT: 'REVIEW',
    REVIEW: 'APPROVED',
    APPROVED: 'PUBLISHED',
    PUBLISHED: 'RETIRED',
  };
  return (
    <div className="form-grid">
      <form
        className="panel form-stack"
        onSubmit={(event) => void createJournal(event)}
        aria-busy={busy}
      >
        <h2>{labels.createJournal}</h2>
        <label className="field">
          {labels.code}
          <input name="code" pattern="[A-Za-z0-9_-]{2,16}" required />
        </label>
        <label className="field">
          {labels.mode}
          <select name="mode">
            {['NATIVE', 'CLOSED', 'EXTERNAL_LINK', 'API_SYNC'].map((mode) => (
              <option key={mode} value={mode}>
                {modeLabels[mode] ?? mode}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {labels.externalUrl}
          <input name="externalUrl" type="url" />
        </label>
        {['uz', 'ru', 'en'].map((suffix) => (
          <fieldset className="field" key={suffix}>
            <legend>{suffix.toUpperCase()}</legend>
            <input name={`name_${suffix}`} placeholder={labels.name} required />
            <input name={`short_${suffix}`} placeholder={labels.shortName} required />
            <textarea name={`description_${suffix}`} placeholder={labels.description} required />
            <textarea name={`contact_${suffix}`} placeholder={labels.contact} />
          </fieldset>
        ))}
        <button className="button" disabled={busy}>
          {labels.create}
        </button>
      </form>
      <form
        className="panel form-stack"
        onSubmit={(event) => void createRequirement(event)}
        aria-busy={busy}
      >
        <h2>{labels.createRequirement}</h2>
        <label className="field">
          {labels.journal}
          <select name="journalId" required>
            {journals.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.code}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {labels.changeNote}
          <textarea name="changeNote" required />
        </label>
        <label className="field">
          {labels.config}
          <textarea
            name="config"
            defaultValue={
              '{"requiredFiles":[{"category":"MANUSCRIPT","labels":{"uz-Latn":"Asosiy maqola","ru":"Основная статья","en":"Main manuscript"},"formats":["docx"],"required":true,"preflightRequired":true}],"limits":{"maxBytes":19922944,"maxFiles":10,"maxTotalBytes":52428800},"preflight":{"docx":{"rulesVersion":"journal-draft-v1","requiredMarkers":[]}},"workflow":{"reviewModel":"NO_EXTERNAL_REVIEW","requiredReviewerCount":0,"decisionRequiresCompletedReviews":false}}'
            }
            rows={5}
            required
          />
        </label>
        {['uz', 'ru', 'en'].map((suffix) => (
          <fieldset className="field" key={suffix}>
            <legend>{suffix.toUpperCase()}</legend>
            <input name={`title_${suffix}`} placeholder={labels.title} required />
            <textarea name={`summary_${suffix}`} placeholder={labels.summary} required />
            <textarea name={`body_${suffix}`} placeholder={labels.body} rows={4} required />
          </fieldset>
        ))}
        <button className="button" disabled={busy}>
          {labels.create}
        </button>
      </form>
      {journals.map((journal) => {
        const localization = (locale: string) =>
          journal.localizations.find((entry) => entry.locale === locale);
        const localDate = (value: string | null) =>
          value ? new Date(value).toISOString().slice(0, 16) : '';
        return (
          <details className="panel" key={`edit-${journal.id}`}>
            <summary>
              {labels.editJournal}: {journal.code}
            </summary>
            <form
              className="form-stack"
              onSubmit={(event) => void updateJournal(event, journal)}
              aria-busy={busy}
            >
              <label className="field">
                {labels.mode}
                <select name="edit_mode" defaultValue={journal.mode}>
                  {['NATIVE', 'CLOSED', 'EXTERNAL_LINK', 'API_SYNC', 'ARCHIVED'].map((mode) => (
                    <option key={mode} value={mode}>
                      {modeLabels[mode] ?? mode}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {labels.externalUrl}
                <input
                  name="edit_external_url"
                  type="url"
                  defaultValue={journal.externalUrl ?? ''}
                />
              </label>
              <div className="form-grid compact">
                <label className="field">
                  {labels.acceptanceOpens}
                  <input
                    name="edit_acceptance_opens"
                    type="datetime-local"
                    defaultValue={localDate(journal.acceptanceOpensAt)}
                  />
                </label>
                <label className="field">
                  {labels.acceptanceCloses}
                  <input
                    name="edit_acceptance_closes"
                    type="datetime-local"
                    defaultValue={localDate(journal.acceptanceClosesAt)}
                  />
                </label>
              </div>
              <label className="check-row">
                <input name="edit_active" type="checkbox" defaultChecked={journal.active} />{' '}
                {labels.active}
              </label>
              <label className="check-row">
                <input
                  name="edit_four_eyes"
                  type="checkbox"
                  defaultChecked={journal.fourEyesRequired}
                />{' '}
                {labels.fourEyes}
              </label>
              {[
                ['uz', 'uz_Latn'],
                ['ru', 'ru'],
                ['en', 'en'],
              ].map(([suffix, locale]) => {
                const value = localization(locale!);
                return (
                  <fieldset className="field" key={`${journal.id}-${locale}`}>
                    <legend>{suffix!.toUpperCase()}</legend>
                    <input
                      name={`edit_name_${suffix}`}
                      defaultValue={value?.name ?? ''}
                      placeholder={labels.name}
                      required
                    />
                    <input
                      name={`edit_short_${suffix}`}
                      defaultValue={value?.shortName ?? ''}
                      placeholder={labels.shortName}
                      required
                    />
                    <textarea
                      name={`edit_description_${suffix}`}
                      defaultValue={value?.description ?? ''}
                      placeholder={labels.description}
                      required
                    />
                    <textarea
                      name={`edit_contact_${suffix}`}
                      defaultValue={value?.contactText ?? ''}
                      placeholder={labels.contact}
                    />
                  </fieldset>
                );
              })}
              <button className="button" disabled={busy}>
                {labels.save}
              </button>
            </form>
          </details>
        );
      })}
      <section className="panel form-stack">
        <h2>{labels.lifecycle}</h2>
        {journals.map((journal) => (
          <div className="button-row" key={`journal-${journal.id}`}>
            <span className="identifier">
              {journal.code} · {modeLabels[journal.mode] ?? journal.mode}
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void send(
                  `/api/journals/${journal.id}`,
                  {
                    mode: journal.mode === 'NATIVE' ? 'CLOSED' : 'NATIVE',
                    expectedUpdatedAt: journal.updatedAt,
                  },
                  'PATCH',
                )
              }
            >
              {journal.mode === 'NATIVE' ? labels.close : labels.open}
            </button>
          </div>
        ))}
        {journals
          .flatMap((journal) => journal.requirementVersions)
          .filter((version) => next[version.state])
          .map((version) => (
            <div className="button-row" key={version.id}>
              <span>
                v{version.version} · {stateLabels[version.state] ?? version.state}
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void send(`/api/requirements/${version.id}/state`, {
                    targetState: next[version.state],
                    expectedRowVersion: version.rowVersion,
                  })
                }
              >
                {labels.advance}: {stateLabels[next[version.state]!] ?? next[version.state]}
              </button>
            </div>
          ))}
      </section>
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
    </div>
  );
}
