'use client';

import type { PostgresBackupStatus, StackarrTask } from '@stackarr/core';
import { Button, Label, Switch } from '@stackarr/ui';
import { useEffect, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './PostgresBackupSettings.module.css';
import { Badge } from './ui';

type Config = Record<string, string>;
type Response = { config: Config; status: PostgresBackupStatus };
type BackupCommand = 'PostgresBackupTest' | 'PostgresBackupSync';
type ActiveTask = { id: string; command: BackupCommand };
const prefix = 'STACKARR_PG_BACKUP_';
const keys = ['ENABLED', 'SCHEDULE', 'WEEKDAY', 'TIME', 'TIMEZONE'] as const;

export function PostgresBackupSettings() {
  const [saved, setSaved] = useState<Config | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<PostgresBackupStatus | null>(null);
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<'save' | BackupCommand | null>(null);
  const [task, setTask] = useState<ActiveTask | null>(null);
  const [needsReload, setNeedsReload] = useState(false);

  async function refresh(updateDraft = false) {
    const response = await stackarrFetch('/api/v1/postgres-backup', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load backup status.');
    const body = (await response.json()) as Response;
    setStatus(body.status);
    if (updateDraft) {
      setSaved(body.config);
      setConfig(body.config);
      setNeedsReload(false);
    }
  }
  useEffect(() => {
    void refresh(true).catch(() => setMessage('Could not load backup settings.'));
  }, []);
  useEffect(() => {
    if (!task) return;
    const active = task;
    let cancelled = false;
    async function poll() {
      try {
        const response = await stackarrFetch('/api/v1/task', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const tasks = (await response.json()) as StackarrTask[];
        const current = tasks.find((item) => item.id === active.id);
        if (cancelled || !current || !['completed', 'failed', 'blocked'].includes(current.status)) return;
        setTask(null);
        const label = active.command === 'PostgresBackupTest' ? 'Target test' : 'Backup sync';
        setMessage(`${label} ${current.status}.`);
        void refresh().catch(() => setMessage(`${label} ${current.status}; could not refresh status.`));
      } catch {
        if (!cancelled) setMessage('Task queued; status polling is temporarily unavailable.');
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [task]);
  function change(key: string, value: string) {
    setConfig((current) => (current ? { ...current, [prefix + key]: value } : current));
  }
  async function save() {
    if (!config) return;
    setPending('save');
    setMessage('');
    try {
      const patch: Config = Object.fromEntries(keys.map((key) => [prefix + key, config[prefix + key]]));
      if (url) patch[`${prefix}URL`] = url;
      const response = await stackarrFetch('/api/v1/config/stackarr', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ config: patch, currentPassword: password })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.error ?? 'Could not save.');
        return;
      }
      setUrl('');
      setPassword('');
      await refresh(true);
      setMessage('Saved. No remote connection was made.');
    } catch {
      setNeedsReload(true);
      setMessage('Could not confirm saved settings. Reload before testing or syncing.');
    } finally {
      setPending(null);
    }
  }
  async function action(name: BackupCommand) {
    setPending(name);
    setMessage('');
    try {
      const response = await stackarrFetch('/api/v1/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(body.message ?? 'Could not queue task.');
        return;
      }
      if (typeof body.id !== 'string' || !body.id) throw new Error('Missing task ID');
      setTask({ id: body.id, command: name });
      setMessage(`${name === 'PostgresBackupTest' ? 'Target test' : 'Backup sync'} queued.`);
    } catch {
      setMessage('Could not queue task.');
    } finally {
      setPending(null);
    }
  }
  if (!config || !saved) return <p role="status">{message || 'Loading PostgreSQL backup settings…'}</p>;
  const field = (key: string) => config[prefix + key] ?? '';
  const dirty = Boolean(url) || keys.some((key) => field(key) !== (saved[prefix + key] ?? ''));
  const canRun = !pending && !task && !dirty && !needsReload && Boolean(saved[`${prefix}URL`]);
  return (
    <div className={styles.editor}>
      <p className={styles.intro}>
        Store native PostgreSQL archives in your own dedicated backup database, separate from Stackarr&apos;s portable
        telemetry and account database. This is not a queryable mirror. Keep encrypted file backups for SQLite, media,
        and files. Storage and history may cost money while compute sleeps; status checks do not wake the target.
      </p>
      <Switch
        className={styles.switch}
        isSelected={field('ENABLED') === 'true'}
        onChange={(value) => change('ENABLED', String(value))}
      >
        <Switch.Content>
          <Label>Enable scheduled PostgreSQL backup</Label>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
      <label className={styles.field}>
        <span>Target PostgreSQL URL</span>
        <input
          type="password"
          autoComplete="new-password"
          value={url}
          placeholder={field('URL') ? 'Saved secret, leave blank to keep' : 'postgresql://user:password@host/database'}
          onChange={(event) => setUrl(event.target.value)}
        />
        <small>
          Saved in this installation&apos;s private runtime configuration and masked in settings; not separately
          field-encrypted. Leave blank to keep the target. TLS is verified against the system CA. For independent Neon
          sleep and cost isolation, use a separate project/compute, not another database on the telemetry endpoint.
        </small>
      </label>
      <label className={styles.field}>
        <span>Schedule</span>
        <select value={field('SCHEDULE')} onChange={(event) => change('SCHEDULE', event.target.value)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      {field('SCHEDULE') === 'weekly' && (
        <label className={styles.field}>
          <span>Weekday</span>
          <select value={field('WEEKDAY')} onChange={(event) => change('WEEKDAY', event.target.value)}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <option key={day}>{day}</option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.field}>
        <span>Local time</span>
        <input type="time" value={field('TIME')} onChange={(event) => change('TIME', event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Timezone (IANA)</span>
        <input value={field('TIMEZONE')} onChange={(event) => change('TIMEZONE', event.target.value)} />
      </label>
      <label className={styles.field}>
        <span>Current Stackarr password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <small>Required when changing the target URL.</small>
      </label>
      <div className={styles.actions}>
        <Button
          isPending={pending === 'save'}
          isDisabled={Boolean(pending || task)}
          onPress={() => void save()}
          size="sm"
          variant="primary"
        >
          Save
        </Button>
        <Button
          isPending={pending === 'PostgresBackupTest'}
          isDisabled={!canRun}
          onPress={() => void action('PostgresBackupTest')}
          size="sm"
          variant="secondary"
        >
          Test target
        </Button>
        <Button
          isPending={pending === 'PostgresBackupSync'}
          isDisabled={!canRun}
          onPress={() => void action('PostgresBackupSync')}
          size="sm"
          variant="secondary"
        >
          Sync now
        </Button>
      </div>
      {dirty && <p className={styles.hint}>Save pending changes before testing or syncing the target.</p>}
      {message && (
        <p role="status" className={styles.hint}>
          {message}
        </p>
      )}
      {task && (
        <p role="status" className={styles.hint}>
          {task.command === 'PostgresBackupTest' ? 'Testing target' : 'Syncing backup'}: waiting for task result…
        </p>
      )}
      {status && (
        <section className={styles.status} aria-label="PostgreSQL backup status">
          <div className={styles.statusHeader}>
            <h3>Cached backup status</h3>
            <Badge tone={status.state === 'failed' ? 'bad' : status.state === 'succeeded' ? 'good' : 'neutral'}>
              {status.state}
            </Badge>
          </div>
          <dl className={styles.details}>
            <div>
              <dt>Last attempt</dt>
              <dd>{status.lastAttempt ?? 'Never'}</dd>
            </div>
            <div>
              <dt>Last success</dt>
              <dd>{status.lastSuccess ?? 'Never'}</dd>
            </div>
            <div>
              <dt>Next run</dt>
              <dd>{status.nextRun ?? 'Not scheduled'}</dd>
            </div>
            <div>
              <dt>Last test</dt>
              <dd>{status.lastTest ?? 'Never'}</dd>
            </div>
            <div>
              <dt>Generation</dt>
              <dd>{status.generation ?? 'None'}</dd>
            </div>
            <div>
              <dt>Bytes</dt>
              <dd>{status.bytes ?? '—'}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{status.durationSeconds == null ? '—' : `${status.durationSeconds} seconds`}</dd>
            </div>
          </dl>
          {status.lastError && (
            <p role="alert" className={styles.error}>
              {status.lastError}
            </p>
          )}
          <h4>Coverage</h4>
          {status.coverage.length ? (
            <ul className={styles.coverage}>
              {status.coverage.map((item) => (
                <li key={item.name}>
                  <strong>{item.name}</strong> · schema {item.schema} · extensions{' '}
                  {item.extensions.join(', ') || 'none'}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>No database coverage recorded yet.</p>
          )}
        </section>
      )}
    </div>
  );
}
