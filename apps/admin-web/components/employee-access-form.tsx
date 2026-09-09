'use client';

import { useState, type FormEvent } from 'react';
import { localizedResponseError } from '../lib/client-error';

interface EmployeeAccess {
  id: string;
  displayName: string;
  roles: { role: { code: string } }[];
  journalScopes: { journalId: string }[];
}

export function EmployeeAccessForms({
  employees,
  journals,
  roles,
  roleLabels,
  labels,
}: {
  employees: EmployeeAccess[];
  journals: { id: string; code: string }[];
  roles: readonly string[];
  roleLabels: Record<string, string>;
  labels: Record<string, string>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>, employeeId: string) {
    event.preventDefault();
    setBusy(employeeId);
    setError('');
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/employees/${employeeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        roles: form.getAll('roles'),
        journalIds: form.getAll('journalIds'),
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
      {employees.map((employee) => {
        const assignedRoles = new Set(employee.roles.map((item) => item.role.code));
        const assignedJournals = new Set(employee.journalScopes.map((item) => item.journalId));
        return (
          <details className="panel" key={employee.id}>
            <summary>{employee.displayName}</summary>
            <form
              className="form-stack"
              onSubmit={(event) => void save(event, employee.id)}
              aria-busy={busy === employee.id}
            >
              <fieldset className="field">
                <legend>{labels.roles}</legend>
                {roles.map((role) => (
                  <label className="check-row" key={role}>
                    <input
                      type="checkbox"
                      name="roles"
                      value={role}
                      defaultChecked={assignedRoles.has(role)}
                    />{' '}
                    {roleLabels[role] ?? role}
                  </label>
                ))}
              </fieldset>
              <fieldset className="field">
                <legend>{labels.journals}</legend>
                {journals.map((journal) => (
                  <label className="check-row" key={journal.id}>
                    <input
                      type="checkbox"
                      name="journalIds"
                      value={journal.id}
                      defaultChecked={assignedJournals.has(journal.id)}
                    />{' '}
                    {journal.code}
                  </label>
                ))}
              </fieldset>
              <button className="button" disabled={Boolean(busy)}>
                {labels.save}
              </button>
            </form>
          </details>
        );
      })}
      <div role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </div>
    </section>
  );
}
