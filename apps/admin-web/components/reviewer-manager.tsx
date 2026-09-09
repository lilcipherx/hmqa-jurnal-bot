'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

interface ReviewerRecord {
  id: string;
  active: boolean;
  affiliation: string;
  expertise: unknown;
  employee: { displayName: string };
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

  async function save(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setBusy(id);
    setError('');
    const form = new FormData(event.currentTarget);
    const rawExpertise = form.get('expertise');
    const rawAffiliation = form.get('affiliation');
    const expertise = (typeof rawExpertise === 'string' ? rawExpertise : '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    const response = await fetch(`/api/reviewers/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
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
      {reviewers.map((reviewer) => (
        <details className="panel" key={reviewer.id}>
          <summary>{reviewer.employee.displayName}</summary>
          <form
            className="form-stack"
            onSubmit={(event) => void save(event, reviewer.id)}
            aria-busy={busy === reviewer.id}
          >
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
