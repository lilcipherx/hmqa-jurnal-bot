'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

export function DecisionForm({
  submissionId,
  labels,
}: {
  submissionId: string;
  labels: {
    heading: string;
    decision: string;
    accept: string;
    reject: string;
    publicReason: string;
    internalReason: string;
    submit: string;
  };
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/submissions/${submissionId}/decisions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision: form.get('decision'),
        publicReason: form.get('publicReason'),
        internalBasis: form.get('internalBasis'),
      }),
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
      <label className="field" htmlFor="decision">
        {labels.decision}
        <select id="decision" name="decision" required>
          <option value="ACCEPT">{labels.accept}</option>
          <option value="REJECT">{labels.reject}</option>
        </select>
      </label>
      <label className="field" htmlFor="decisionPublicReason">
        {labels.publicReason}
        <textarea id="decisionPublicReason" name="publicReason" rows={3} required />
      </label>
      <label className="field" htmlFor="decisionInternalBasis">
        {labels.internalReason}
        <textarea id="decisionInternalBasis" name="internalBasis" rows={3} required />
      </label>
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
      <button className="button" type="submit" disabled={busy}>
        {busy ? `${labels.submit}…` : labels.submit}
      </button>
    </form>
  );
}
