'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function EmployeeInviteForm({ labels }: { labels: Record<string, string> }) {
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        displayName: form.get('displayName'),
        currentPassword: text(form, 'currentPassword'),
        currentTotp: text(form, 'currentTotp'),
        confirmation: form.get('confirmation') === 'on',
      }),
    });
    if (response.ok) {
      const invitation = (await response.json()) as { invitationToken: string };
      setResult(
        `${window.location.origin}/invite?token=${encodeURIComponent(invitation.invitationToken)}`,
      );
      setBusy(false);
    } else {
      setError(await localizedResponseError(response));
      setBusy(false);
    }
  }
  return (
    <form className="panel form-stack" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <h2>{labels.heading}</h2>
      <label className="field">
        {labels.name}
        <input name="displayName" required minLength={2} />
      </label>
      <label className="field">
        {labels.email}
        <input name="email" type="email" required />
      </label>
      <label className="field">
        {labels.currentPassword}
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label className="field">
        {labels.currentTotp}
        <input name="currentTotp" inputMode="numeric" pattern="[0-9]{6}" required />
      </label>
      <label className="checkbox-row">
        <input name="confirmation" type="checkbox" required />
        <span>{labels.confirm}</span>
      </label>
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
      {result ? (
        <output className="notice">
          <strong>{labels.invitation}</strong>
          <span className="identifier">{result}</span>
        </output>
      ) : null}
      <button className="button" disabled={busy}>
        {labels.submit}
      </button>
    </form>
  );
}
