'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

interface ReviewAssignment {
  id: string;
  status: string;
  deadline: string;
  anonymizedFileId: string;
  submission: { publicId: string; status: string };
  review: { recommendation: string; submittedAt: string } | null;
}

export function ReviewWorkspace({
  items,
  locale,
  labels,
  statusLabels,
  recommendationLabels,
}: {
  items: ReviewAssignment[];
  locale: string;
  labels: Record<string, string>;
  statusLabels: Record<string, string>;
  recommendationLabels: Record<string, string>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  async function respond(id: string, response: 'ACCEPTED' | 'DECLINED') {
    setBusy(id);
    setMessage('');
    const result = await fetch(`/api/review-assignments/${id}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response, conflictDeclared: response === 'DECLINED' }),
    });
    if (result.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(result));
      setBusy('');
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    setBusy(id);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const result = await fetch(`/api/review-assignments/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recommendation: form.get('recommendation'),
        publicComments: form.get('publicComments'),
        confidentialComments: form.get('confidentialComments') || undefined,
      }),
    });
    if (result.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(result));
      setBusy('');
    }
  }

  return (
    <div className="card-grid">
      {items.map((item) => (
        <article className="panel form-stack" key={item.id} aria-busy={busy === item.id}>
          <div>
            <strong>{item.submission.publicId}</strong>
            <p>
              {labels.deadline}: {new Date(item.deadline).toLocaleString(locale)}
            </p>
            <span className="badge">{statusLabels[item.status] ?? item.status}</span>
          </div>
          <a className="button secondary" href={`/api/files/${item.anonymizedFileId}/download`}>
            {labels.download}
          </a>
          {item.status === 'PENDING' ? (
            <div className="button-row">
              <button
                className="button"
                disabled={busy === item.id}
                onClick={() => void respond(item.id, 'ACCEPTED')}
              >
                {labels.acceptAssignment}
              </button>
              <button
                className="button secondary"
                disabled={busy === item.id}
                onClick={() => void respond(item.id, 'DECLINED')}
              >
                {labels.declineAssignment}
              </button>
            </div>
          ) : null}
          {item.status === 'ACCEPTED' ? (
            <form className="form-stack" onSubmit={(event) => void submitReview(event, item.id)}>
              <label className="field">
                {labels.recommendation}
                <select name="recommendation" required>
                  <option value="ACCEPT">{labels.accept}</option>
                  <option value="MINOR_REVISION">{labels.minorRevision}</option>
                  <option value="MAJOR_REVISION">{labels.majorRevision}</option>
                  <option value="REJECT">{labels.reject}</option>
                </select>
              </label>
              <label className="field">
                {labels.publicComments}
                <textarea name="publicComments" rows={5} required />
              </label>
              <label className="field">
                {labels.confidentialComments}
                <textarea name="confidentialComments" rows={4} />
              </label>
              <button className="button" type="submit" disabled={busy === item.id}>
                {labels.submit}
              </button>
            </form>
          ) : null}
          {item.review ? (
            <p>
              {labels.submitted}:{' '}
              {recommendationLabels[item.review.recommendation] ?? item.review.recommendation}
            </p>
          ) : null}
        </article>
      ))}
      {items.length === 0 ? <p className="panel empty">{labels.empty}</p> : null}
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
    </div>
  );
}
