'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

export function MessageForm({
  submissionId,
  labels,
}: {
  submissionId: string;
  labels: Record<string, string>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/submissions/${submissionId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visibility: form.get('visibility'), body: form.get('body') }),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy(false);
    }
  }
  return (
    <form className="panel form-stack" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <h2>{labels.heading}</h2>
      <label className="field">
        {labels.visibility}
        <select name="visibility" required>
          <option value="PUBLIC">{labels.public}</option>
          <option value="INTERNAL">{labels.internal}</option>
        </select>
      </label>
      <label className="field">
        {labels.message}
        <textarea name="body" rows={5} required />
      </label>
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
      <button className="button" disabled={busy}>
        {labels.send}
      </button>
    </form>
  );
}
