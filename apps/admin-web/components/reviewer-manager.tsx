'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

interface ReviewerRecord {
  id: string;
  active: boolean;
  displayName: string;
  email: string | null;
  phone: string | null;
  affiliation: string;
  expertise: unknown;
}

export function ReviewerManager({
  reviewers,
  labels,
}: {
  reviewers: ReviewerRecord[];
  labels: Record<string, string>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault();
    setBusy(id ?? 'new');
    setError('');
    const form = new FormData(event.currentTarget);
    const rawExpertise = form.get('expertise');
    const rawAffiliation = form.get('affiliation');
    const expertise = (typeof rawExpertise === 'string' ? rawExpertise : '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const response = await fetch(id ? `/api/reviewers/${id}` : '/api/reviewers', {
      method: id ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: form.get('displayName'),
        email: form.get('email') || (id ? null : undefined),
        phone: form.get('phone') || (id ? null : undefined),
        affiliation: typeof rawAffiliation === 'string' ? rawAffiliation : '',
        expertise,
        active: form.get('active') === 'on',
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setError(await localizedResponseError(response));
      setBusy('');
    }
  }

  return (
    <section className="form-stack">
      <h2>{labels.heading}</h2>
      <form className="panel form-stack" onSubmit={(event) => void save(event)}>
        <h3>{labels.create}</h3>
        <label className="field">
          {labels.name}
          <input name="displayName" required minLength={2} maxLength={200} />
        </label>
        <label className="field">
          {labels.email}
          <input name="email" type="email" />
        </label>
        <label className="field">
          {labels.phone}
          <input name="phone" type="tel" />
        </label>
        <label className="field">
          {labels.affiliation}
          <input name="affiliation" required maxLength={300} />
        </label>
        <label className="field">
          {labels.expertise}
          <input name="expertise" />
        </label>
        <input name="active" type="hidden" value="on" />
        <button className="button" disabled={Boolean(busy)}>
          {labels.add}
        </button>
      </form>
      {reviewers.map((reviewer) => (
        <details className="panel" key={reviewer.id}>
          <summary>{reviewer.displayName}</summary>
          <form
            className="form-stack"
            onSubmit={(event) => void save(event, reviewer.id)}
            aria-busy={busy === reviewer.id}
          >
            <label className="field">
              {labels.name}
              <input name="displayName" defaultValue={reviewer.displayName} required />
            </label>
            <label className="field">
              {labels.email}
              <input name="email" type="email" defaultValue={reviewer.email ?? ''} />
            </label>
            <label className="field">
              {labels.phone}
              <input name="phone" type="tel" defaultValue={reviewer.phone ?? ''} />
            </label>
            <label className="field">
              {labels.affiliation}
              <input
                name="affiliation"
                defaultValue={reviewer.affiliation}
                required
                maxLength={300}
              />
            </label>
            <label className="field">
              {labels.expertise}
              <input
                name="expertise"
                defaultValue={
                  Array.isArray(reviewer.expertise) ? reviewer.expertise.join(', ') : ''
                }
              />
            </label>
            <label className="check-row">
              <input name="active" type="checkbox" defaultChecked={reviewer.active} />{' '}
              {labels.active}
            </label>
            <button className="button" disabled={Boolean(busy)}>
              {labels.save}
            </button>
          </form>
        </details>
      ))}
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
    </section>
  );
}
