'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

export function EmployeeStatusButton({
  id,
  status,
  labels,
}: {
  id: string;
  status: string;
  labels: Record<string, string>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const target = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/employees/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: target,
        currentPassword: form.get('currentPassword'),
        currentTotp: form.get('currentTotp'),
        confirmation: form.get('confirmation') === 'on',
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setError(await localizedResponseError(response));
      setBusy(false);
    }
  }
  return (
    <>
      <button className="button secondary" disabled={busy} onClick={() => setOpen(!open)}>
        {target === 'ACTIVE' ? labels.activate : labels.suspend}
      </button>
      {open ? (
        <form className="inline-security-form" onSubmit={(event) => void update(event)}>
          <strong>{labels.warning}</strong>
          <label className="field">
            {labels.currentPassword}
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label className="field">
            {labels.currentTotp}
            <input name="currentTotp" inputMode="numeric" pattern="[0-9]{6}" required />
          </label>
          <label className="checkbox-row">
            <input name="confirmation" type="checkbox" required />
            <span>{labels.confirm}</span>
          </label>
          <div className="button-row">
            <button className="button" disabled={busy}>
              {labels.continue}
            </button>
            <button className="button secondary" type="button" onClick={() => setOpen(false)}>
              {labels.cancel}
            </button>
          </div>
        </form>
      ) : null}
      <span role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </span>
    </>
  );
}
