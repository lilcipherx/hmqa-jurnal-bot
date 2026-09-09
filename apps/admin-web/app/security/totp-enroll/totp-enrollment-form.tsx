'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { localizedResponseError } from '../../../lib/client-error';

interface EnrollmentDetails {
  email: string;
  displayName: string;
  totpSecret: string;
  expiresAt: string;
}

export function TotpEnrollmentForm({
  labels,
}: {
  labels: {
    loading: string;
    account: string;
    secret: string;
    help: string;
    totp: string;
    submit: string;
    expired: string;
    signIn: string;
  };
}) {
  const [details, setDetails] = useState<EnrollmentDetails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/totp/enrollment', { cache: 'no-store' }).then(async (response) => {
      if (!active) return;
      if (!response.ok) {
        setError(labels.expired);
        return;
      }
      setDetails((await response.json()) as EnrollmentDetails);
    });
    return () => {
      active = false;
    };
  }, [labels.expired]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/totp/enrollment/complete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ totp: form.get('totp') }),
    });
    if (!response.ok) {
      setError(await localizedResponseError(response));
      setBusy(false);
      return;
    }
    const body = (await response.json().catch(() => null)) as { csrfToken?: string } | null;
    if (!body?.csrfToken) {
      setError(labels.expired);
      setBusy(false);
      return;
    }
    window.location.assign('/dashboard');
  }

  if (!details)
    return (
      <div className="form-stack">
        <p>{error || labels.loading}</p>
        {error ? (
          <a className="link-button" href="/login">
            {labels.signIn}
          </a>
        ) : null}
      </div>
    );

  return (
    <form className="panel form-stack" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <p>
        {labels.account}: <strong>{details.displayName}</strong> ({details.email})
      </p>
      <div className="notice">
        <strong>{labels.secret}</strong>
        <span className="identifier" data-testid="totp-enrollment-secret">
          {details.totpSecret}
        </span>
        <small>{labels.help}</small>
      </div>
      <label className="field" htmlFor="enrollment-totp">
        {labels.totp}
        <input
          id="enrollment-totp"
          name="totp"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
          required
        />
      </label>
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
      <button className="button" type="submit" disabled={busy}>
        {busy ? `${labels.submit}…` : labels.submit}
      </button>
    </form>
  );
}
