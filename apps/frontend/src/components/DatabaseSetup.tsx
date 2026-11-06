'use client';

import type { StackarrEnv } from '@stackarr/core';
import { DatabaseDiagnosticsPanel } from './DatabaseDiagnosticsPanel';

type Props = {
  saved: StackarrEnv;
  draft: StackarrEnv;
  update: (key: string, value: string) => void;
};

export const databaseSetupKeys = new Set([
  'POSTGRES_DEPLOYMENT_MODE',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'STACKARR_DATABASE_MODE'
]);

export function databaseSetupChanged(saved: StackarrEnv, draft: StackarrEnv) {
  return [...databaseSetupKeys].some((key) => (saved[key] || '') !== (draft[key] || ''));
}

export function databaseEndpointError(draft: StackarrEnv) {
  if (!['external', 'independent'].includes(draft.POSTGRES_DEPLOYMENT_MODE || '')) return '';
  const host = draft.POSTGRES_HOST || '';
  const port = draft.POSTGRES_PORT || '';
  return /^[a-z0-9.-]+$/i.test(host) &&
    !['localhost', '127.0.0.1', 'database', 'redis', 'youtarr-db'].includes(host.toLowerCase()) &&
    /^[1-9]\d{0,4}$/.test(port) &&
    Number(port) <= 65535
    ? ''
    : 'Enter a container-reachable PostgreSQL host and a port from 1 to 65535 before saving.';
}

export function DatabaseSetup({ saved, draft, update }: Props) {
  const mode = ['external', 'independent'].includes(draft.POSTGRES_DEPLOYMENT_MODE || '') ? 'external' : 'managed';
  const savedMode = ['external', 'independent'].includes(saved.POSTGRES_DEPLOYMENT_MODE || '') ? 'external' : 'managed';
  const changed = databaseSetupChanged(saved, draft);
  const host = draft.POSTGRES_HOST || '';
  const port = draft.POSTGRES_PORT || '';
  const errors = databaseEndpointError(draft);

  return (
    <section
      aria-label="PostgreSQL deployment"
      style={{
        gridColumn: '1 / -1',
        border: '1px solid var(--border, #7775)',
        borderRadius: 12,
        padding: '1rem',
        display: 'grid',
        gap: '1rem'
      }}
    >
      <header>
        <h3>PostgreSQL deployment</h3>
        <p>
          Choose where participating app databases connect. The bundled managed TimescaleDB container remains the
          default. This does not move data or install a database. Returning from an external endpoint requires restoring
          the complete saved client configuration and credentials, not only changing this selector. Disable an existing
          scheduled PostgreSQL backup before changing ownership.
        </p>
      </header>
      <fieldset style={{ border: 0, padding: 0, display: 'grid', gap: '.5rem' }}>
        <legend>Server ownership</legend>
        <label>
          <input
            type="radio"
            name="postgres-deployment"
            checked={mode === 'managed'}
            onChange={() => {
              update('POSTGRES_DEPLOYMENT_MODE', 'managed');
              update('POSTGRES_HOST', '');
              update('POSTGRES_PORT', '');
            }}
          />{' '}
          Bundled managed TimescaleDB (default)
        </label>
        <label>
          <input
            type="radio"
            name="postgres-deployment"
            checked={mode === 'external'}
            onChange={() => update('POSTGRES_DEPLOYMENT_MODE', 'external')}
          />{' '}
          Existing native or external PostgreSQL (you manage it)
        </label>
      </fieldset>
      {mode === 'external' && (
        <div style={{ display: 'grid', gap: '.75rem' }}>
          <p>
            Supply a DNS name or address reachable from the <strong>app containers</strong>, not host-only loopback. A
            native server must already be running and reachable; Stackarr does not install or restart it.
          </p>
          <label>
            PostgreSQL host
            <br />
            <input
              aria-invalid={Boolean(errors)}
              autoComplete="off"
              value={host}
              onChange={(e) => update('POSTGRES_HOST', e.target.value)}
              placeholder="db.example.invalid"
            />
          </label>
          <label>
            PostgreSQL port
            <br />
            <input
              aria-invalid={Boolean(errors)}
              inputMode="numeric"
              value={port}
              onChange={(e) => update('POSTGRES_PORT', e.target.value)}
              placeholder="5432"
            />
          </label>
          {errors && <p role="alert">{errors}</p>}
          <p>
            Prepare a compatible PostgreSQL major version, separate app databases and roles with the required ownership,
            CONNECT and schema privileges, existing data, extension binaries and per-database extensions. Tracearr needs
            TimescaleDB; BookOrbit needs uuid-ossp, pg_trgm and vector; Immich needs its selected vector extension plus
            cube and earthdistance. Check preload libraries and pending restart with the server owner. TLS is not
            configured by these host/port fields: field-based diagnostics currently use unencrypted connections. Do not
            cut over a TLS-required server until each app has a verified TLS connection path.
          </p>
        </div>
      )}
      <div>
        <h4>Stackarr state</h4>
        <label htmlFor="stackarr-db-mode">Runtime database mode</label>{' '}
        <select
          id="stackarr-db-mode"
          value={draft.STACKARR_DATABASE_MODE === 'postgres' ? 'postgres' : 'app-default'}
          onChange={(e) => update('STACKARR_DATABASE_MODE', e.target.value)}
        >
          <option value="app-default">App defaults (Stackarr SQLite)</option>
          <option value="postgres">Shared PostgreSQL (Stackarr and supported Arr state)</option>
        </select>
        <p>
          App defaults does not remove the PostgreSQL dependency of other enabled apps. Switching Stackarr state is a
          separate data migration, not a connection-only change.
        </p>
      </div>
      <div>
        <h4>Review before saving</h4>
        <p>
          Saved: {savedMode === 'managed' ? 'bundled managed' : 'existing external/native'} → selected:{' '}
          {mode === 'managed' ? 'bundled managed' : 'existing external/native'}
          {mode === 'external' ? ` (${host || 'host required'}:${port || 'port required'})` : ''}. Stackarr state:{' '}
          {draft.STACKARR_DATABASE_MODE === 'postgres' ? 'shared PostgreSQL' : 'app defaults'}.
        </p>
        {changed && (
          <p role="status">
            Unsaved database selection. Save stores configuration only; it does not test this draft, reconcile
            containers, migrate data, or guarantee backup coverage. Review all app-specific credentials and URLs in
            Advanced; the general save route may generate or preserve connection URLs. A stale URL can block projection
            at apply time. Take and verify a recovery point before an explicit, separately reviewed cutover.
          </p>
        )}
        <p>
          Rollback: keep the original server, data and credentials intact. If cutover fails, restore the previous
          endpoint and mode from your recorded configuration, explicitly reconcile affected clients, and verify
          application data against the original backup. Do not point apps back to an empty database.
        </p>
        <p>
          <a href="/docs/operations/custom-database">Prerequisites, backup limits and manual migration guide</a>
        </p>
      </div>
      <DatabaseDiagnosticsPanel savedConfigurationChanged={changed} />
    </section>
  );
}
