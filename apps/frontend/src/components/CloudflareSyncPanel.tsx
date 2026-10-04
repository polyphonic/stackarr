'use client';

import type { CloudflareSyncResult } from '@stackarr/core/cloudflareSync';
import { toast } from '@stackarr/ui/toast';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './CloudflareSyncPanel.module.css';
import { stackarrFetch } from './clientApi';

type SyncState = 'syncing' | 'synced' | 'error';

export function CloudflareSyncPanel() {
  const router = useRouter();
  const started = useRef(false);
  const [state, setState] = useState<SyncState>('syncing');
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<CloudflareSyncResult | null>(null);

  const sync = useCallback(
    async (manual: boolean) => {
      setState('syncing');
      setError('');
      const toastId = manual ? toast.loading('Syncing settings from Cloudflare...') : undefined;

      try {
        const response = await stackarrFetch('/api/v1/cloudflare/sync', {
          method: 'POST',
          cache: 'no-store'
        });
        const body = (await response.json().catch(() => ({}))) as Partial<CloudflareSyncResult> & { error?: string };
        if (!response.ok || !body.config || !body.syncedAt) {
          throw new Error(body.error || 'Cloudflare settings sync failed.');
        }

        const result = body as CloudflareSyncResult;
        setSnapshot(result);
        setState('synced');
        router.refresh();
        if (manual && toastId) toast.success('Cloudflare settings are up to date.', { id: toastId });
      } catch (syncError) {
        const detail = syncError instanceof Error ? syncError.message : 'Cloudflare settings sync failed.';
        setError(detail);
        setState('error');
        if (manual && toastId) toast.error(detail, { id: toastId });
      }
    },
    [router]
  );

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sync(false);
  }, [sync]);

  return (
    <section className={styles.panel} aria-labelledby="cloudflare-sync-title">
      <div className={styles.header}>
        <div>
          <h3 id="cloudflare-sync-title">Cloudflare source</h3>
          <p>
            This page checks the live tunnel and Access policy when it opens. Stackarr imports recognized settings and
            leaves other Cloudflare routes untouched.
          </p>
        </div>
        <button disabled={state === 'syncing'} onClick={() => void sync(true)} type="button">
          {state === 'syncing' ? 'Syncing...' : 'Sync now'}
        </button>
      </div>

      <div className={styles.status} aria-live="polite">
        {state === 'syncing' && <span>Reading the live tunnel and Access policy...</span>}
        {state === 'error' && <span className={styles.error}>{error}</span>}
        {state === 'synced' && snapshot && (
          <span>
            Synced <time dateTime={snapshot.syncedAt}>{new Date(snapshot.syncedAt).toLocaleString()}</time>.
          </span>
        )}
      </div>

      {snapshot && (
        <dl className={styles.summary}>
          <div>
            <dt>Stackarr routes</dt>
            <dd>{snapshot.managedRoutes.length}</dd>
          </div>
          <div>
            <dt>Cloudflare-only routes</dt>
            <dd>{snapshot.externalRoutes.length}</dd>
          </div>
          <div>
            <dt>Allowed emails</dt>
            <dd>{snapshot.access.allowedEmails.length}</dd>
          </div>
          <div>
            <dt>API token</dt>
            <dd>{snapshot.apiTokenConfigured ? 'Available' : 'Missing'}</dd>
          </div>
        </dl>
      )}

      {snapshot && snapshot.externalRoutes.length > 0 && (
        <div className={styles.externalRoutes}>
          <strong>Cloudflare-only routes</strong>
          <p>Shown for awareness. Stackarr will not change these routes when publishing its own entries.</p>
          <ul>
            {snapshot.externalRoutes.map((route) => (
              <li key={route.hostname}>
                <span>{route.hostname}</span>
                <code>{route.target}</code>
                <small>{route.access ? 'Access protected' : 'Public'}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
