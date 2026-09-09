'use client';

import { useState } from 'react';
import { localizedResponseError } from '../lib/client-error';

export function NotificationOperations({
  items,
  labels,
  statusLabels,
}: {
  items: {
    id: string;
    eventCode: string;
    status: string;
    attempts: number;
    lastErrorCode: string | null;
    submission: { publicId: string } | null;
  }[];
  labels: Record<string, string>;
  statusLabels: Record<string, string>;
}) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  async function replay(id: string) {
    setBusy(id);
    setMessage('');
    const response = await fetch(`/api/notifications/${id}/replay`, { method: 'POST' });
    if (response.ok) window.location.reload();
    else {
      setMessage(await localizedResponseError(response));
      setBusy('');
    }
  }
  return (
    <div className="card-grid">
      {items.map((item) => (
        <article className="panel form-stack" key={item.id}>
          <strong>{item.submission?.publicId ?? item.eventCode}</strong>
          <span className="badge">{statusLabels[item.status] ?? item.status}</span>
          <span>
            {labels.attempts}: {item.attempts}
          </span>
          {item.lastErrorCode ? <span className="error">{item.lastErrorCode}</span> : null}
          {['FAILED', 'DEAD_LETTER'].includes(item.status) ? (
            <button
              className="button"
              disabled={busy === item.id}
              onClick={() => void replay(item.id)}
            >
              {labels.replay}
            </button>
          ) : null}
        </article>
      ))}
      <div role="alert" className={message ? 'error' : 'sr-only'}>
        {message}
      </div>
    </div>
  );
}
