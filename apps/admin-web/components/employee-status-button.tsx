'use client';

import { useState } from 'react';
import { localizedResponseError } from '../lib/client-error';

export function EmployeeStatusButton({
  id,
  status,
  labels,
}: {
  id: string;
  status: string;
  labels: Record<string, string>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const target = status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  async function update() {
    setBusy(true);
    setError('');
    const response = await fetch(`/api/employees/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: target }),
    });
    if (response.ok) window.location.reload();
    else {
      setError(await localizedResponseError(response));
      setBusy(false);
    }
  }
  return (
    <>
      <button className="button secondary" disabled={busy} onClick={() => void update()}>
        {target === 'ACTIVE' ? labels.activate : labels.suspend}
      </button>
      <span role="alert" className={error ? 'error' : 'sr-only'}>
        {error}
      </span>
    </>
  );
}
