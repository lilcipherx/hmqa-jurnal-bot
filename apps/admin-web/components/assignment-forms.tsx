'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

interface StaffOption {
  id: string;
  displayName: string;
  roles: string[];
}

interface ReviewerOption {
  id: string;
  affiliation: string;
  employee: { displayName: string };
}

export function AssignmentForms({
  submissionId,
  employees,
  reviewers,
  files,
  canAssignStaff,
  canAssignReviewers,
  roleLabels,
  labels,
}: {
  submissionId: string;
  employees: StaffOption[];
  reviewers: ReviewerOption[];
  files: { id: string; originalName: string }[];
  canAssignStaff: boolean;
  canAssignReviewers: boolean;
  roleLabels: Record<string, string>;
  labels: Record<string, string>;
}) {
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>, kind: 'staff' | 'reviewer') {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setMessageIsError(false);
    const form = new FormData(event.currentTarget);
    const body =
      kind === 'staff'
        ? {
            employeeId: form.get('employeeId'),
            kind: form.get('kind'),
            reason: form.get('reason'),
            deadline: text(form, 'staffDeadline')
              ? new Date(text(form, 'staffDeadline')).toISOString()
              : undefined,
          }
        : {
            reviewerId: form.get('reviewerId'),
            anonymizedFileId: form.get('anonymizedFileId'),
            deadline: new Date(text(form, 'reviewDeadline')).toISOString(),
          };
    const endpoint = kind === 'staff' ? 'assignments' : 'reviewer-assignments';
    const response = await fetch(`/api/submissions/${submissionId}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setMessageIsError(true);
      setBusy(false);
    }
  }

  async function uploadAnonymized(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setMessageIsError(false);
    const form = new FormData(event.currentTarget);
    const file = form.get('package');
    const attested = form.get('anonymizationAttested') === 'on';
    if (!(file instanceof File) || file.size < 1 || !attested) {
      setMessage(labels.uploadValidation!);
      setMessageIsError(true);
      setBusy(false);
      return;
    }
    const upload = new FormData();
    upload.set('file', file, file.name);
    const response = await fetch(`/api/submissions/${submissionId}/anonymized-files`, {
      method: 'POST',
      headers: { 'x-anonymization-attested': 'true' },
      body: upload,
    });
    if (response.ok) {
      event.currentTarget.reset();
      setMessage(labels.uploadQueued!);
    } else {
      setMessage(await localizedResponseError(response));
      setMessageIsError(true);
    }
    setBusy(false);
  }

  return (
    <div className="form-grid">
      {canAssignStaff ? (
        <form
          className="panel form-stack"
          onSubmit={(event) => void send(event, 'staff')}
          aria-busy={busy}
        >
          <h2>{labels.staffHeading}</h2>
          <label className="field">
            {labels.kind}
            <select name="kind" required>
              <option value="OPERATOR">{labels.operator}</option>
              <option value="EDITOR">{labels.editor}</option>
            </select>
          </label>
          <label className="field">
            {labels.employee}
            <select name="employeeId" required>
              {employees.map((employee) => (
                <option value={employee.id} key={employee.id}>
                  {employee.displayName} ·{' '}
                  {employee.roles.map((role) => roleLabels[role] ?? role).join(', ')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {labels.reason}
            <textarea name="reason" required rows={3} />
          </label>
          <label className="field">
            {labels.deadline}
            <input name="staffDeadline" type="datetime-local" />
          </label>
          <button className="button" disabled={busy || employees.length === 0}>
            {labels.assign}
          </button>
        </form>
      ) : null}
      {canAssignReviewers ? (
        <>
          <form
            className="panel form-stack"
            onSubmit={(event) => void uploadAnonymized(event)}
            aria-busy={busy}
          >
            <h2>{labels.uploadHeading}</h2>
            <p className="muted">{labels.uploadHelp}</p>
            <label className="field">
              {labels.anonymizedFile}
              <input
                name="package"
                type="file"
                accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                required
              />
            </label>
            <label className="checkbox-row">
              <input name="anonymizationAttested" type="checkbox" required />
              <span>{labels.attestation}</span>
            </label>
            <button className="button" disabled={busy}>
              {labels.upload}
            </button>
          </form>
          <form
            className="panel form-stack"
            onSubmit={(event) => void send(event, 'reviewer')}
            aria-busy={busy}
          >
            <h2>{labels.reviewerHeading}</h2>
            <label className="field">
              {labels.reviewer}
              <select name="reviewerId" required>
                {reviewers.map((reviewer) => (
                  <option value={reviewer.id} key={reviewer.id}>
                    {reviewer.employee.displayName} · {reviewer.affiliation}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {labels.anonymizedFile}
              <select name="anonymizedFileId" required>
                {files.map((file) => (
                  <option value={file.id} key={file.id}>
                    {file.originalName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {labels.deadline}
              <input name="reviewDeadline" type="datetime-local" required />
            </label>
            <button
              className="button"
              disabled={busy || reviewers.length === 0 || files.length === 0}
            >
              {labels.assign}
            </button>
          </form>
        </>
      ) : null}
      <div role="alert" className={message ? (messageIsError ? 'error' : 'notice') : 'sr-only'}>
        {message}
      </div>
    </div>
  );
}
