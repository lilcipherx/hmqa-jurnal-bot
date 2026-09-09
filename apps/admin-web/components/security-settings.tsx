'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

interface SecurityLabels {
  heading: string;
  status: string;
  enabled: string;
  pending: string;
  passwordHeading: string;
  currentPassword: string;
  currentTotp: string;
  newPassword: string;
  confirmPassword: string;
  changePassword: string;
  passwordMismatch: string;
  resetHeading: string;
  resetDescription: string;
  resetWarning: string;
  continue: string;
  confirmReset: string;
  cancel: string;
}

export function SecuritySettings({
  totpEnabled,
  labels,
}: {
  totpEnabled: boolean;
  labels: SecurityLabels;
}) {
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError('');
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword') !== form.get('confirmPassword')) {
      setPasswordError(labels.passwordMismatch);
      return;
    }
    setPasswordBusy(true);
    const response = await fetch('/api/auth/password/change', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: form.get('currentPassword'),
        currentTotp: form.get('currentTotp'),
        newPassword: form.get('newPassword'),
        confirmation: true,
      }),
    });
    if (!response.ok) {
      setPasswordError(await localizedResponseError(response));
      setPasswordBusy(false);
      return;
    }
    window.location.assign('/login');
  }

  async function resetTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetError('');
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }
    setResetBusy(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/totp/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currentPassword: form.get('currentPassword'),
        currentTotp: form.get('currentTotp'),
        confirmation: true,
      }),
    });
    if (!response.ok) {
      setResetError(await localizedResponseError(response));
      setResetBusy(false);
      setConfirmingReset(false);
      return;
    }
    window.location.assign('/login');
  }

  return (
    <section className="form-stack security-settings" aria-labelledby="security-heading">
      <h2 id="security-heading">{labels.heading}</h2>
      <p>
        {labels.status}:{' '}
        <span className="badge">{totpEnabled ? labels.enabled : labels.pending}</span>
      </p>

      <form
        className="panel form-stack"
        onSubmit={(event) => void changePassword(event)}
        aria-busy={passwordBusy}
        data-testid="change-password-form"
      >
        <h3>{labels.passwordHeading}</h3>
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
        <label className="field">
          {labels.newPassword}
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={14}
            required
          />
        </label>
        <label className="field">
          {labels.confirmPassword}
          <input
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            minLength={14}
            required
          />
        </label>
        <div role="alert" className={passwordError ? 'error' : 'sr-only'}>
          {passwordError}
        </div>
        <button className="button" type="submit" disabled={passwordBusy}>
          {passwordBusy ? `${labels.changePassword}…` : labels.changePassword}
        </button>
      </form>

      <form
        className="panel form-stack"
        onSubmit={(event) => void resetTotp(event)}
        aria-busy={resetBusy}
        data-testid="self-totp-reset-form"
      >
        <h3>{labels.resetHeading}</h3>
        <p>{labels.resetDescription}</p>
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
        {confirmingReset ? (
          <div className="notice" role="status">
            <strong>{labels.resetWarning}</strong>
          </div>
        ) : null}
        <div role="alert" className={resetError ? 'error' : 'sr-only'}>
          {resetError}
        </div>
        <div className="button-row">
          <button className="button" type="submit" disabled={resetBusy}>
            {confirmingReset ? labels.confirmReset : labels.continue}
          </button>
          {confirmingReset ? (
            <button
              className="button secondary"
              type="button"
              disabled={resetBusy}
              onClick={() => setConfirmingReset(false)}
            >
              {labels.cancel}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
