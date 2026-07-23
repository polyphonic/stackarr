'use client';

import type { AgentActivityRecord } from '@stackarr/core';
import { useDeferredValue, useMemo, useState } from 'react';
import styles from './AgentToolCallTable.module.css';

const pageSize = 25;

export function AgentToolCallTable({ records }: { records: AgentActivityRecord[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const filtered = useMemo(
    () =>
      records.filter(
        (record) =>
          (status === 'all' || record.status === status) &&
          [record.caller, record.toolName, record.category, record.risk, record.status, record.error]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(deferredQuery)
      ),
    [deferredQuery, records, status]
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const selected = selectedId ? records.find((record) => record.id === selectedId) : undefined;

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <h2>Agent Activity</h2>
          <p>Every MCP action is recorded from request through success, denial, or error.</p>
        </div>
        <div className={styles.filters}>
          <input
            aria-label="Search Agent Activity"
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search caller or action…"
            type="search"
            value={query}
          />
          <select
            aria-label="Filter Agent Activity by status"
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
            value={status}
          >
            <option value="all">All statuses</option>
            <option value="success">Success</option>
            <option value="started">Running</option>
            <option value="denied">Denied</option>
            <option value="error">Error</option>
          </select>
        </div>
      </header>
      <div className={styles.layout}>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Agent action</th>
                <th>Access</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr
                  aria-selected={record.id === selectedId}
                  className={record.id === selectedId ? styles.selected : undefined}
                  key={record.id}
                  onClick={() => setSelectedId(record.id)}
                >
                  <td>{formatTime(record.timestamp)}</td>
                  <td>
                    <button onClick={() => setSelectedId(record.id)} type="button">
                      {actionLabel(record.toolName)}
                    </button>
                    <code>{record.toolName}</code>
                    <span className={styles.caller}>{callerLabel(record.caller)}</span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[record.risk]}`}>{record.risk}</span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${styles[record.status]}`}>{record.status}</span>
                  </td>
                  <td>{record.durationMs === undefined ? '—' : `${record.durationMs} ms`}</td>
                </tr>
              ))}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5}>No Agent Activity matches these filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <footer className={styles.pagination}>
            <span>
              {filtered.length === 0 ? 0 : safePage * pageSize + 1}–
              {Math.min((safePage + 1) * pageSize, filtered.length)} of {filtered.length}
            </span>
            <div>
              <button
                disabled={safePage === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                type="button"
              >
                Previous
              </button>
              <button
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                type="button"
              >
                Next
              </button>
            </div>
          </footer>
        </div>
        <aside className={styles.detail} aria-label="Selected agent activity record">
          {selected ? (
            <>
              <div className={styles.detailHeading}>
                <div>
                  <span>{callerLabel(selected.caller)}</span>
                  <h3>{actionLabel(selected.toolName)}</h3>
                </div>
                <button aria-label="Close details" onClick={() => setSelectedId(undefined)} type="button">
                  Close
                </button>
              </div>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd>{selected.status}</dd>
                </div>
                <div>
                  <dt>Recorded</dt>
                  <dd>{formatTime(selected.timestamp)}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{selected.category}</dd>
                </div>
                <div>
                  <dt>Scopes</dt>
                  <dd>{selected.scopes.join(', ') || '—'}</dd>
                </div>
              </dl>
              {selected.error ? <p className={styles.error}>{selected.error}</p> : null}
              <h4>Redacted record</h4>
              <pre>{JSON.stringify(selected, null, 2)}</pre>
            </>
          ) : (
            <div className={styles.detailEmpty}>
              <h3>Select an activity record</h3>
              <p>Details are formatted only when opened, keeping large histories responsive.</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function callerLabel(caller: string) {
  if (caller.startsWith('mcp-local:')) return `${titleCase(caller.slice('mcp-local:'.length))} · local MCP`;
  if (caller.startsWith('mcp-remote:')) return 'Remote MCP policy';
  if (caller === 'mcp-local') return 'Local MCP client';
  return titleCase(caller);
}

function actionLabel(name: string) {
  return titleCase(name.replace(/^stackarr_/, '').replaceAll('_', ' '));
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string) {
  return `${new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
    timeZone: 'UTC'
  }).format(new Date(value))} UTC`;
}
