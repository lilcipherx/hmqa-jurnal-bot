'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

interface PrivacyCase {
  id: string;
  publicId: string;
  type: string;
  status: string;
  dueAt: string;
  rowVersion: number;
  identityVerifiedAt: string | null;
  decisionReason: string | null;
  activeLegalHoldCount: number;
  subject: { id: string; displayName: string; email: string; phone: string } | null;
}

interface LegalHold {
  id: string;
  status: string;
  reason: string;
  placedAt: string;
  submission: { publicId: string } | null;
  dataSubjectRequest: { publicId: string } | null;
}

const transitions: Readonly<Record<string, readonly string[]>> = {
  RECEIVED: ['IDENTITY_VERIFICATION', 'CANCELLED'],
  IDENTITY_VERIFICATION: ['IN_REVIEW', 'DENIED', 'CANCELLED'],
  IN_REVIEW: ['APPROVED', 'DENIED', 'CANCELLED'],
  APPROVED: ['EXECUTING'],
  EXECUTING: ['COMPLETED'],
};

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function PrivacyCaseManager({
  cases,
  holds,
  typeLabels,
  statusLabels,
  holdStatusLabels,
  labels,
  canManage,
  canManageHolds,
}: {
  cases: PrivacyCase[];
  holds: LegalHold[];
  typeLabels: Record<string, string>;
  statusLabels: Record<string, string>;
  holdStatusLabels: Record<string, string>;
  labels: Record<string, string>;
  canManage: boolean;
  canManageHolds: boolean;
}) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  async function updateCase(event: FormEvent<HTMLFormElement>, item: PrivacyCase) {
    event.preventDefault();
    setBusy(item.id);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const decisionReason = formText(form, 'decisionReason');
    const report = formText(form, 'executionReport');
    const response = await fetch(`/api/privacy/requests/${item.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedRowVersion: item.rowVersion,
        targetStatus: formText(form, 'targetStatus'),
        ...(decisionReason ? { decisionReason } : {}),
        ...(report ? { executionReport: { summary: report } } : {}),
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy('');
    }
  }

  async function placeHold(event: FormEvent<HTMLFormElement>, item: PrivacyCase) {
    event.preventDefault();
    if (!item.subject) return;
    setBusy(`hold-${item.id}`);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/privacy/legal-holds', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subjectUserId: item.subject.id,
        dataSubjectRequestId: item.id,
        reason: formText(form, 'reason'),
      }),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy('');
    }
  }

  async function releaseHold(event: FormEvent<HTMLFormElement>, hold: LegalHold) {
    event.preventDefault();
    setBusy(`release-${hold.id}`);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/privacy/legal-holds/${hold.id}/release`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ releaseReason: formText(form, 'releaseReason') }),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy('');
    }
  }

  return (
    <>
      <div className="card-grid">
        {cases.map((item) => (
          <article className="panel form-stack" key={item.id}>
            <div className="button-row">
              <strong className="identifier">{item.publicId}</strong>
              <span className="badge">{statusLabels[item.status] ?? item.status}</span>
            </div>
            <strong>{typeLabels[item.type] ?? item.type}</strong>
            {item.subject ? (
              <div className="notice">
                <span>{item.subject.displayName}</span>
                <span>{item.subject.email}</span>
                <span>{item.subject.phone}</span>
              </div>
            ) : null}
            <span>
              {labels.dueAt}: {item.dueAt}
            </span>
            <span>
              {labels.activeHolds}: {item.activeLegalHoldCount}
            </span>
            {item.decisionReason ? <p>{item.decisionReason}</p> : null}
            {canManage && (transitions[item.status]?.length ?? 0) > 0 ? (
              <form className="form-stack" onSubmit={(event) => void updateCase(event, item)}>
                <label className="field">
                  {labels.targetStatus}
                  <select name="targetStatus" required>
                    {transitions[item.status]!.map((status) => (
                      <option value={status} key={status}>
                        {statusLabels[status] ?? status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {labels.decisionReason}
                  <textarea name="decisionReason" rows={3} maxLength={4000} />
                </label>
                <label className="field">
                  {labels.executionReport}
                  <textarea name="executionReport" rows={3} maxLength={4000} />
                </label>
                <button className="button" disabled={busy === item.id}>
                  {labels.update}
                </button>
              </form>
            ) : null}
            {canManageHolds && item.subject && item.activeLegalHoldCount === 0 ? (
              <form className="form-stack" onSubmit={(event) => void placeHold(event, item)}>
                <label className="field">
                  {labels.holdReason}
                  <textarea name="reason" required minLength={10} maxLength={4000} rows={3} />
                </label>
                <button className="button secondary" disabled={busy === `hold-${item.id}`}>
                  {labels.placeHold}
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </div>
      <section className="panel">
        <h2>{labels.legalHolds}</h2>
        <div className="card-grid">
          {holds.map((hold) => (
            <article className="notice" key={hold.id}>
              <strong>
                {hold.dataSubjectRequest?.publicId ?? hold.submission?.publicId ?? hold.id}
              </strong>
              <span className="badge">{holdStatusLabels[hold.status] ?? hold.status}</span>
              <p>{hold.reason}</p>
              {canManageHolds && hold.status === 'ACTIVE' ? (
                <form className="form-stack" onSubmit={(event) => void releaseHold(event, hold)}>
                  <label className="field">
                    {labels.releaseReason}
                    <textarea
                      name="releaseReason"
                      required
                      minLength={10}
                      maxLength={4000}
                      rows={3}
                    />
                  </label>
                  <button className="button" disabled={busy === `release-${hold.id}`}>
                    {labels.releaseHold}
                  </button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
    </>
  );
}
