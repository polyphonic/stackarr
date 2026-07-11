'use client';

import { useEffect, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './ServerLogViewer.module.css';

type LogFile = { filename: string; size: number; lastWriteTime: string };
type LogTail = { filename: string; lastWriteTime: string; size: number; truncated: boolean; lines: string[] };

export function ServerLogViewer() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [activeFile, setActiveFile] = useState('');
  const [tail, setTail] = useState<LogTail | null>(null);
  const [message, setMessage] = useState('Loading server logs…');

  useEffect(() => {
    let cancelled = false;
    stackarrFetch('/api/v1/log/file')
      .then(async (response) => {
        const body = (await response.json().catch(() => [])) as LogFile[];
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body)) {
          setMessage('Server logs could not be loaded.');
          return;
        }
        const sorted = [...body].sort((a, b) => b.lastWriteTime.localeCompare(a.lastWriteTime));
        setFiles(sorted);
        setMessage(sorted.length === 0 ? 'No server log files have been recorded yet.' : '');
        if (sorted[0]) setActiveFile(sorted[0].filename);
      })
      .catch(() => !cancelled && setMessage('Server logs could not be loaded.'));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeFile) return;
    let cancelled = false;
    setMessage('Loading log tail…');
    stackarrFetch(`/api/v1/log/file?filename=${encodeURIComponent(activeFile)}&lines=200`)
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as LogTail | null;
        if (cancelled) return;
        if (!response.ok || !body || !Array.isArray(body.lines)) {
          setMessage('This log file could not be loaded.');
          return;
        }
        setTail(body);
        setMessage('');
      })
      .catch(() => !cancelled && setMessage('This log file could not be loaded.'));
    return () => {
      cancelled = true;
    };
  }, [activeFile]);

  return (
    <div className={styles.viewer}>
      <aside className={styles.files} aria-label="Server log files">
        {files.map((file) => (
          <button
            key={file.filename}
            className={activeFile === file.filename ? styles.fileActive : styles.file}
            onClick={() => setActiveFile(file.filename)}
            type="button"
          >
            <strong>{file.filename}</strong>
            <small>
              {formatDate(file.lastWriteTime)} · {formatBytes(file.size)}
            </small>
          </button>
        ))}
        {files.length === 0 && <p>{message}</p>}
      </aside>
      <section className={styles.output} aria-live="polite" aria-label="Selected log output">
        <header>
          <div>
            <strong>{tail?.filename ?? 'Server trail'}</strong>
            {tail && <small>Last write {formatDate(tail.lastWriteTime)}</small>}
          </div>
          {tail?.truncated && <span>Latest 200 lines</span>}
        </header>
        {message ? <p>{message}</p> : <pre>{tail?.lines.join('\n') || 'This log is empty.'}</pre>}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
