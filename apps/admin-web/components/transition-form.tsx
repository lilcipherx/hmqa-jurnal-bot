'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export const transitionStatuses = [
  'SUBMITTED',
  'TECHNICAL_REVIEW',
  'NEEDS_CORRECTION',
  'REGISTERED',
  'EDITORIAL_REVIEW',
  'UNDER_REVIEW',
  'REVISION_REQUESTED',
  'REVISION_SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'COPYEDITING',
  'LAYOUT',
  'PUBLISHED',
  'WITHDRAWN',
  'ARCHIVED',
];

export function TransitionForm({
  submissionId,
  rowVersion,
  labels,
  statusLabels,
  decisionProposals,
  statuses,
}: {
  submissionId: string;
  rowVersion: number;
  labels: {
    submit: string;
    status: string;
    publicReason: string;
    internalReason: string;
    deadline: string;
    publicationReference: string;
    decisionProposal: string;
    none: string;
    acceptDecision: string;
    rejectDecision: string;
  };
  statusLabels: Record<string, string>;
  decisionProposals: { id: string; decision: string; preparedBy: string }[];
  statuses: readonly string[];
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const form = new FormData(event.currentTarget);
    const body = {
      expectedRowVersion: rowVersion,
      targetStatus: form.get('targetStatus'),
      publicReason: form.get('publicReason') || undefined,
      internalReason: form.get('internalReason') || undefined,
      deadline: text(form, 'deadline') ? new Date(text(form, 'deadline')).toISOString() : undefined,
      publicationReference: form.get('publicationReference') || undefined,
      decisionProposalId: form.get('decisionProposalId') || undefined,
      confirm: true,
    };
    const response = await fetch(`/api/submissions/${submissionId}/transitions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy(false);
    }
  }
  return (
    <form className="panel form-stack" onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <label className="field" htmlFor="targetStatus">
        {labels.status}
        <select id="targetStatus" name="targetStatus" required>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {statusLabels[status] ?? status}
            </option>
          ))}
        </select>
      </label>
      <label className="field" htmlFor="publicReason">
        {labels.publicReason}
        <textarea id="publicReason" name="publicReason" rows={3} />
      </label>
      <label className="field" htmlFor="internalReason">
        {labels.internalReason}
        <textarea id="internalReason" name="internalReason" rows={3} />
      </label>
      <label className="field" htmlFor="deadline">
        {labels.deadline}
        <input id="deadline" name="deadline" type="datetime-local" />
      </label>
      <label className="field" htmlFor="publicationReference">
        {labels.publicationReference}
        <input id="publicationReference" name="publicationReference" type="url" />
      </label>
      {decisionProposals.length > 0 ? (
        <label className="field" htmlFor="decisionProposalId">
          {labels.decisionProposal}
          <select id="decisionProposalId" name="decisionProposalId">
            <option value="">{labels.none}</option>
            {decisionProposals.map((proposal) => (
              <option key={proposal.id} value={proposal.id}>
                {proposal.decision === 'ACCEPT' ? labels.acceptDecision : labels.rejectDecision} ·{' '}
                {proposal.preparedBy}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
      <button className="button" type="submit" disabled={busy}>
        {busy ? `${labels.submit}…` : labels.submit}
      </button>
    </form>
  );
}
