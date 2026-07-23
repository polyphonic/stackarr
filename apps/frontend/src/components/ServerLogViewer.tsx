'use client';

import { useEffect, useMemo, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './ServerLogViewer.module.css';

type LogFile = { filename: string; size: number; lastWriteTime: string };
type LogTail = { filename: string; lastWriteTime: string; size: number; truncated: boolean; lines: string[] };

export function ServerLogViewer() {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [activeFile, setActiveFile] = useState('');
  const [tail, setTail] = useState<LogTail | null>(null);
  const [lineLimit, setLineLimit] = useState(120);
  const [fileMessage, setFileMessage] = useState('Loading server logs…');
  const [tailMessage, setTailMessage] = useState('');
  const output = useMemo(() => tail?.lines.join('\n') || 'This log is empty.', [tail]);

  useEffect(() => {
    const controller = new AbortController();
    void stackarrFetch('/api/v1/log/file', { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => [])) as LogFile[];
        if (!response.ok || !Array.isArray(body)) {
          setFileMessage('Server logs could not be loaded.');
          return;
        }
        setFiles(body);
        setFileMessage(body.length === 0 ? 'No server log files have been recorded yet.' : '');
        if (body[0]) setActiveFile(body[0].filename);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setFileMessage('Server logs could not be loaded.');
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!activeFile) return;
    const controller = new AbortController();
    setTailMessage('Loading log tail…');
    void stackarrFetch(`/api/v1/log/file?filename=${encodeURIComponent(activeFile)}&lines=${lineLimit}`, {
      signal: controller.signal
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as LogTail | null;
        if (!response.ok || !body || !Array.isArray(body.lines)) {
          setTailMessage('This log file could not be loaded.');
          return;
        }
        setTail(body);
        setTailMessage('');
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setTailMessage('This log file could not be loaded.');
      });
    return () => controller.abort();
  }, [activeFile, lineLimit]);

  return (
    <div className={styles.viewer}>
      <aside className={styles.files} aria-label="Server log files">
        {files.map((file) => (
          <button
            key={file.filename}
            className={activeFile === file.filename ? styles.fileActive : styles.file}
            onClick={() => {
              setLineLimit(120);
              setActiveFile(file.filename);
            }}
            type="button"
          >
            <strong>{file.filename}</strong>
            <small>
              {formatDate(file.lastWriteTime)} · {formatBytes(file.size)}
            </small>
          </button>
        ))}
        {files.length === 0 && <p>{fileMessage}</p>}
      </aside>
      <section className={styles.output} aria-live="polite" aria-label="Selected log output">
        <header>
          <div>
            <strong>{tail?.filename ?? 'Server trail'}</strong>
            {tail && <small>Last write {formatDate(tail.lastWriteTime)}</small>}
          </div>
          {tail?.truncated ? (
            <button disabled={lineLimit >= 500} onClick={() => setLineLimit(500)} type="button">
              {lineLimit >= 500 ? 'Latest 500 lines' : 'Load up to 500 lines'}
            </button>
          ) : null}
        </header>
        {tailMessage ? <p>{tailMessage}</p> : <pre>{output}</pre>}
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
