'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function TranslationManager({
  versions,
  labels,
  stateLabels,
}: {
  versions: { id: string; key: string; locale: string; version: number; state: string }[];
  labels: Record<string, string>;
  stateLabels: Record<string, string>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const key = text(form, 'key');
    const response = await fetch(`/api/translations/${encodeURIComponent(key)}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        namespace: form.get('namespace'),
        description: form.get('description'),
        locale: form.get('locale'),
        message: form.get('message'),
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy(false);
    }
  }
  async function advance(id: string, targetState: string) {
    setBusy(true);
    setMessage('');
    const response = await fetch(`/api/translation-versions/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetState }),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy(false);
    }
  }
  const nextState: Record<string, string> = {
    DRAFT: 'REVIEW',
    REVIEW: 'APPROVED',
    APPROVED: 'PUBLISHED',
    PUBLISHED: 'RETIRED',
  };
  return (
    <div className="form-grid">
      <form className="panel form-stack" onSubmit={(event) => void create(event)} aria-busy={busy}>
        <h2>{labels.create}</h2>
        <label className="field">
          {labels.key}
          <input name="key" pattern="[a-z][a-z0-9_.-]{2,199}" required />
        </label>
        <label className="field">
          {labels.namespace}
          <input name="namespace" required />
        </label>
        <label className="field">
          {labels.description}
          <input name="description" required />
        </label>
        <label className="field">
          {labels.locale}
          <select name="locale">
            <option value="uz-Latn">O‘zbekcha</option>
            <option value="ru">Русский</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="field">
          {labels.message}
          <textarea name="message" rows={5} required />
        </label>
        <button className="button" disabled={busy}>
          {labels.save}
        </button>
      </form>
      <section className="panel form-stack">
        <h2>{labels.lifecycle}</h2>
        {versions
          .filter((version) => nextState[version.state])
          .map((version) => (
            <div className="button-row" key={version.id}>
              <span className="identifier">
                {version.key} · {version.locale}:v{version.version} ·{' '}
                {stateLabels[version.state] ?? version.state}
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void advance(version.id, nextState[version.state]!)}
              >
                {labels.advance}:{' '}
                {stateLabels[nextState[version.state]!] ?? nextState[version.state]}
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
