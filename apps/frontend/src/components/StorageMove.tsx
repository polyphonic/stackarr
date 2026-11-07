'use client';

import { useEffect, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './StorageMove.module.css';

type MoveStatus = {
  id: string;
  phase: 'queued' | 'planning' | 'stopping' | 'copying' | 'starting' | 'completed' | 'failed';
  destination: string;
  updatedAt: string;
  message?: string;
};
type MoveReply = {
  available?: boolean;
  configRoot?: string;
  physicalDestination?: string;
  status?: MoveStatus | null;
  error?: string;
  setup?: string;
};

export function StorageMove() {
  const [reply, setReply] = useState<MoveReply | null>(null);
  const [destination, setDestination] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const response = await stackarrFetch('/api/v1/storage/move', { cache: 'no-store' });
        const body = (await response.json()) as MoveReply;
        if (!active) return;
        if (!response.ok && response.status !== 503) throw new Error(body.error || 'Could not load move status');
        if (response.status === 503 && body.available === false) {
          setReply((previous) =>
            previous?.status && !['completed', 'failed'].includes(previous.status.phase) ? previous : body
          );
          setDisconnected(true);
          return;
        }
        setReply(body);
        setDisconnected(false);
      } catch {
        if (active) setDisconnected(true);
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  async function move() {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      const response = await stackarrFetch('/api/v1/storage/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination, confirm: true })
      });
      const body = (await response.json()) as MoveReply;
      if (!response.ok) {
        setMessage(body.error || 'Could not queue the move');
        return;
      }
      setReply((previous) => ({ ...previous, status: body.status }));
      setConfirmed(false);
      setMessage('Move queued. Keep this page open to watch progress.');
    } catch {
      // The controller may stop during the move; the next poll reconciles the request.
      setDisconnected(true);
      setMessage(
        'Connection lost. The request may have been queued; wait for the controller to reconnect before retrying.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const status = reply?.status;
  const inProgress = status && !['completed', 'failed'].includes(status.phase);
  return (
    <section className={styles.move} aria-labelledby="move-configuration-heading">
      <h3 id="move-configuration-heading">Move configuration</h3>
      <p>
        Move the complete application configuration to another local disk. This is separate from changing media,
        download or backup roots above.
      </p>
      <dl className={styles.paths}>
        <dt>Logical configuration root</dt>
        <dd>
          <code>{reply?.configRoot || '—'}</code>
        </dd>
        <dt>Physical destination</dt>
        <dd>
          <code>{reply?.physicalDestination || '—'}</code>
        </dd>
      </dl>
      {disconnected && inProgress && (
        <p role="status">Controller disconnected during the move. Reconnecting; this does not mean the move failed.</p>
      )}
      {status && (
        <p role="status">
          <strong>Move: {status.phase}</strong> · {status.destination}
          {status.message && ` — ${status.message}`}
        </p>
      )}
      {reply?.available === false && (
        <p role="status">
          {reply.error}. {reply.setup}
        </p>
      )}
      {reply?.available && !status && (
        <>
          <label htmlFor="storage-move-destination">New physical destination (absolute host path)</label>
          <input
            id="storage-move-destination"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
            placeholder="/path/on/mounted/disk/Stackarr/config"
            autoComplete="off"
          />
          <label className={styles.confirm}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>
              I understand the stack will stop (downtime), copy and verify the complete configuration, then restart. The
              original will be retained for rollback; it will not be deleted automatically.
            </span>
          </label>
          <button
            type="button"
            onClick={() => void move()}
            disabled={!destination || !confirmed || submitting || disconnected}
          >
            {submitting ? 'Queuing…' : 'Move configuration'}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
