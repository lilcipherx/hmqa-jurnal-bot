'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function EmployeeInviteForm({
  journals,
  labels,
  roleLabels,
}: {
  journals: { id: string; code: string }[];
  labels: Record<string, string>;
  roleLabels: Record<string, string>;
}) {
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
        role: form.get('role'),
        journalIds: form.getAll('journalIds'),
        reviewerAffiliation: form.get('reviewerAffiliation') || undefined,
        reviewerExpertise: text(form, 'reviewerExpertise')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
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
        {labels.role}
        <select name="role" required>
          {[
            'OPERATOR',
            'EDITOR',
            'REVIEWER',
            'CHIEF_EDITOR',
            'CONTENT_ADMIN',
            'ADMIN',
            'AUDITOR',
          ].map((role) => (
            <option key={role} value={role}>
              {roleLabels[role] ?? role}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>{labels.journals}</legend>
        {journals.map((journal) => (
          <label className="check-row" key={journal.id}>
            <input type="checkbox" name="journalIds" value={journal.id} /> {journal.code}
          </label>
        ))}
      </fieldset>
      <label className="field">
        {labels.affiliation}
        <input name="reviewerAffiliation" />
      </label>
      <label className="field">
        {labels.expertise}
        <input name="reviewerExpertise" />
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
