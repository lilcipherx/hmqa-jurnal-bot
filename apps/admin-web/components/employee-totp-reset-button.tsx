'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

export function EmployeeTotpResetButton({
  id,
  totpEnabled,
  labels,
}: {
  id: string;
  totpEnabled: boolean;
  labels: {
    reset: string;
    pending: string;
    currentPassword: string;
    currentTotp: string;
    continue: string;
    warning: string;
    confirm: string;
    cancel: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!totpEnabled)
    return (
      <button className="button secondary" type="button" disabled>
        {labels.pending}
      </button>
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/employees/${id}/totp/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: form.get('currentPassword'),
        currentTotp: form.get('currentTotp'),
        confirmation: true,
      }),
    });
    if (!response.ok) {
      setError(await localizedResponseError(response));
      setBusy(false);
      setConfirming(false);
      return;
    }
    window.location.reload();
  }

  if (!open)
    return (
      <button
        className="button secondary"
        type="button"
        data-testid={`reset-totp-${id}`}
        onClick={() => setOpen(true)}
      >
        {labels.reset}
      </button>
    );

  return (
    <form
      className="inline-security-form"
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      data-testid={`reset-totp-form-${id}`}
    >
      <label className="field">
        {labels.currentPassword}
        <input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label className="field">
        {labels.currentTotp}
        <input
          name="currentTotp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
        />
      </label>
      {confirming ? (
        <div className="notice" role="status">
          {labels.warning}
        </div>
      ) : null}
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
      <div className="button-row">
        <button className="button" type="submit" disabled={busy}>
          {confirming ? labels.confirm : labels.continue}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setConfirming(false);
            setError('');
          }}
        >
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}
