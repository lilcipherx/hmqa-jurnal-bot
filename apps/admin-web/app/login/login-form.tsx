'use client';

import { useEffect, useState, type FormEvent } from 'react';

export function LoginForm({
  labels,
}: {
  labels: { email: string; password: string; totp: string; submit: string; invalid: string };
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
        totp: form.get('totp'),
      }),
    });
    const body = (await response.json().catch(() => null)) as { csrfToken?: string } | null;
    if (!response.ok || !body?.csrfToken) {
      setError(labels.invalid);
      setBusy(false);
      return;
    }
    window.location.assign('/dashboard');
  }
  return (
    <form
      className="form-stack"
      onSubmit={(event) => void submit(event)}
      aria-busy={busy}
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <label className="field" htmlFor="email">
        {labels.email}
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          spellCheck={false}
          required
        />
      </label>
      <label className="field" htmlFor="password">
        {labels.password}
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="field" htmlFor="totp">
        {labels.totp}
        <input
          id="totp"
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
