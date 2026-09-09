'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { localizedResponseError } from '../../lib/client-error';

export function InviteForm({ token, labels }: { token: string; labels: Record<string, string> }) {
  const [details, setDetails] = useState<{
    email: string;
    displayName: string;
    totpSecret: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  useEffect(() => {
    void fetch('/api/invitations/inspect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await localizedResponseError(response));
        setDetails(
          (await response.json()) as { email: string; displayName: string; totpSecret: string },
        );
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : (labels.invalid ?? '')),
      );
  }, [labels.invalid, token]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password: form.get('password'), totp: form.get('totp') }),
      });
      if (response.ok) {
        setDone(true);
        return;
      }
      setError(await localizedResponseError(response));
    } catch {
      setError(labels.invalid ?? '');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (done)
    return (
      <div className="panel notice">
        {labels.done}{' '}
        <a className="link-button" href="/login">
          {labels.login}
        </a>
      </div>
    );
  return (
    <form className="panel form-stack" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <h1>{labels.heading}</h1>
      {details ? (
        <p>
          {details.displayName} · {details.email}
        </p>
      ) : null}
      {details ? (
        <div className="notice">
          <strong>{labels.totpSecret}</strong>
          <span className="identifier">{details.totpSecret}</span>
          <small>{labels.totpHelp}</small>
        </div>
      ) : null}
      <label className="field">
        {labels.password}
        <input
          name="password"
          type="password"
          minLength={14}
          required
          autoComplete="new-password"
        />
      </label>
      <label className="field">
        {labels.totp}
        <input
          name="totp"
          inputMode="numeric"
          pattern="[0-9]{6}"
          required
          autoComplete="one-time-code"
        />
      </label>
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
      <button className="button" type="submit" disabled={!details || busy}>
        {busy ? `${labels.submit}…` : labels.submit}
      </button>
    </form>
  );
}
