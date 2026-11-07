'use client';

import type { DatabaseDiagnostics } from '@stackarr/core/databaseDiagnostics';
import { useEffect, useState } from 'react';
import { stackarrFetch } from './clientApi';

/** Mount in Settings → Advanced after the endpoint fields; never writes to PostgreSQL. */
export function DatabaseDiagnosticsPanel({
  savedConfigurationChanged = false
}: {
  savedConfigurationChanged?: boolean;
}) {
  const [data, setData] = useState<DatabaseDiagnostics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const response = await stackarrFetch('/api/v1/database/diagnostics', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setData((await response.json()) as DatabaseDiagnostics);
    } catch {
      setError('Diagnostics unavailable. Check your session or retry.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section aria-label="PostgreSQL diagnostics">
      <h3>PostgreSQL diagnostics</h3>
      <p>
        Read-only inspection of <strong>saved</strong> app connections, not unsaved fields. The bundled TimescaleDB
        container is the managed default; an external server remains yours to configure, back up, and restart. Refresh
        never applies changes or migrates data.
      </p>
      {savedConfigurationChanged && (
        <p role="status">
          Your database selection is unsaved. Inspection still uses the last saved configuration; it is not a test of
          the proposed endpoint.
        </p>
      )}
      <button type="button" disabled={loading} onClick={() => void refresh()}>
        Refresh diagnostics
      </button>
      {loading && <p role="status">Inspecting databases…</p>}
      {error && <p role="alert">{error}</p>}
      {data && (
        <div>
          <p>
            <strong>Ownership:</strong> {data.ownership} · <strong>Reachability:</strong> {data.state} ·{' '}
            <strong>Engine:</strong> {data.engine || 'Unknown'} {data.version || ''}
          </p>
          <p>
            Reachable is not backup-ready or proof of TLS. Field-based inspection currently uses SSL disabled; URL
            connections honor explicit sslmode. Verify application transport and a restore independently.
          </p>
          {data.omittedDatabases && <p>Additional configured databases were omitted by the inspection limit.</p>}
          <h4>Server settings</h4>
          {data.settings.length ? (
            <ul>
              {data.settings.map((s) => (
                <li key={s.name}>
                  <code>{s.name}</code>: <code>{s.value}</code>
                  {s.pendingRestart && ' (pending restart)'}
                </li>
              ))}
            </ul>
          ) : null}
          <p>
            Settings: {data.settingsState}
            {data.restrictedSettings.length ? `; unavailable or restricted: ${data.restrictedSettings.join(', ')}` : ''}
            .
          </p>
          <h4>App databases and extensions</h4>
          {!data.databases.length && <p>No configured PostgreSQL app databases have usable inspection credentials.</p>}
          {data.databases.map((db, index) => (
            <details key={`${db.app}:${db.database}:${index}`}>
              <summary>
                {db.app} · {db.database} · {db.endpoint} · {db.role} · {db.state}
              </summary>
              {db.truncated && <p>Extension list truncated by inspection limit.</p>}
              {db.state !== 'ok' && (
                <p>
                  Could not inspect this database ({db.state}). Check its endpoint, role and CONNECT/catalog
                  permissions.
                </p>
              )}
              {db.extensions.length ? (
                <ul>
                  {db.extensions.map((ext) => (
                    <li key={ext.name}>
                      <code>{ext.name}</code>
                      {ext.required && ' (provisioning contract)'} · installed {ext.installedVersion || 'no'} ·
                      available {ext.availableVersion || 'no'}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No extension inventory available.</p>
              )}
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
