'use client';

import { toast } from '@stackarr/ui/toast';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './ServiceDirectory.module.css';
import { Badge } from './ui';

type StreamripJob = {
  id: string;
  type: 'url' | 'search';
  url?: string;
  source?: string;
  query?: string;
  lidarrAlbumTitle?: string;
  lidarrArtistName?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: string;
  completedAt?: string;
  error?: string;
  outputTail?: string;
};

type StreamripStatus = {
  command: string;
  available: boolean;
  version?: string;
  error?: string;
  jobs: StreamripJob[];
};

type LidarrAlbum = {
  album: { id: number; title: string; releaseDate?: string; monitored?: boolean; percentOfTracks?: number };
  artist?: { name: string };
  query: string;
};

type LidarrAlbumPage = {
  albums: LidarrAlbum[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  message?: string;
};

const sources = ['deezer', 'qobuz', 'tidal', 'soundcloud'];
const pageSize = 60;

export function StreamripDownloader({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [status, setStatus] = useState<StreamripStatus | null>(null);
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('deezer');
  const [query, setQuery] = useState('');
  const [albums, setAlbums] = useState<LidarrAlbum[]>([]);
  const [albumOffset, setAlbumOffset] = useState(0);
  const [albumTotal, setAlbumTotal] = useState<number | null>(null);
  const [hasMoreAlbums, setHasMoreAlbums] = useState(false);
  const [loadingAlbums, setLoadingAlbums] = useState(false);
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const albumListRef = useRef<HTMLDivElement | null>(null);

  const selectedAlbum = useMemo(
    () => albums.find((item) => item.album.id === selectedAlbumId),
    [albums, selectedAlbumId]
  );

  const refreshStatus = useCallback(async () => {
    const response = await stackarrFetch('/api/v1/downloaders/streamrip');
    const body = await response.json().catch(() => null);
    if (body) setStatus(body);
  }, []);

  const loadAlbums = useCallback(
    async ({ reset = false } = {}) => {
      if (loadingAlbums) return;
      const nextOffset = reset ? 0 : albumOffset;
      setLoadingAlbums(true);
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(nextOffset)
      });
      if (query.trim()) params.set('query', query.trim());
      const response = await stackarrFetch(`/api/v1/downloaders/streamrip/lidarr?${params}`);
      const body = (await response.json().catch(() => ({}))) as LidarrAlbumPage;
      setLoadingAlbums(false);

      if (response.ok) {
        const nextAlbums = body.albums ?? [];
        setAlbums((current) => (reset ? nextAlbums : [...current, ...nextAlbums]));
        setAlbumOffset(nextOffset + (body.limit ?? pageSize));
        setAlbumTotal(typeof body.total === 'number' ? body.total : null);
        setHasMoreAlbums(Boolean(body.hasMore));
        setMessage('');
      } else {
        if (reset) setAlbums([]);
        setHasMoreAlbums(false);
        const errorMessage = body.message ?? 'Could not read Lidarr albums.';
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
    },
    [albumOffset, loadingAlbums, query]
  );

  async function startUrlDownload() {
    setBusy(true);
    setMessage('Starting Streamrip URL job...');
    const toastId = toast.loading('Starting Streamrip URL job...');
    const response = await stackarrFetch('/api/v1/downloaders/streamrip', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    });
    await handleDownloadResponse(response, toastId, () => setUrl(''));
  }

  async function startLidarrDownload() {
    if (!selectedAlbum) return;
    setBusy(true);
    setMessage(`Searching ${source} for ${selectedAlbum.query}...`);
    const toastId = toast.loading(`Searching ${source} for ${selectedAlbum.query}...`);
    const response = await stackarrFetch('/api/v1/downloaders/streamrip/lidarr', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ albumId: selectedAlbum.album.id, source })
    });
    await handleDownloadResponse(response, toastId);
  }

  async function handleDownloadResponse(response: Response, toastId: string, onSuccess?: () => void) {
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok || body.accepted === false) {
      const errorMessage = body.message ?? body.error ?? 'Could not start download.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    onSuccess?.();
    const nextMessage = `Started ${body.job?.id ?? body.streamrip?.id ?? 'Streamrip job'}.`;
    setMessage(nextMessage);
    toast.success(nextMessage, { id: toastId });
    await refreshStatus();
  }

  useEffect(() => {
    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshStatus]);

  useEffect(() => {
    if (!open) return;
    setAlbums([]);
    setAlbumOffset(0);
    setSelectedAlbumId(null);
    void loadAlbums({ reset: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => {
      setAlbums([]);
      setAlbumOffset(0);
      setSelectedAlbumId(null);
      void loadAlbums({ reset: true });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  function maybeLoadMoreAlbums() {
    const node = albumListRef.current;
    if (!node || loadingAlbums || !hasMoreAlbums) return;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 180) {
      void loadAlbums();
    }
  }

  if (!open) return null;

  const jobs = status?.jobs ?? [];

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className={styles.modal}
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2>Download with Streamrip</h2>
            <p>Use a direct album URL, or search/download a Lidarr album through Stackarr's Streamrip runner.</p>
          </div>
          <button className={styles.closeButton} onClick={onClose} type="button" aria-label="Close">
            x
          </button>
        </header>

        <div className={styles.modalBody}>
          <section className={styles.group}>
            <h3>Status</h3>
            <p>
              <Badge tone={status?.available ? 'good' : 'bad'}>
                {status?.available ? 'CLI ready' : 'CLI unavailable'}
              </Badge>{' '}
              {status?.version ?? status?.error ?? 'Checking Streamrip...'}
            </p>
          </section>

          <section className={styles.group}>
            <h3>Direct URL</h3>
            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Album / playlist / track URL</span>
                <input
                  placeholder="https://www.deezer.com/album/..."
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
                <small>Paste any URL supported by `rip url`.</small>
              </label>
            </div>
            <button
              className={styles.primary}
              disabled={busy || !url.trim()}
              onClick={() => void startUrlDownload()}
              type="button"
            >
              Download URL
            </button>
          </section>

          <section className={styles.group}>
            <h3>Lidarr album</h3>
            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Filter albums</span>
                <input placeholder="artist or album" value={query} onChange={(event) => setQuery(event.target.value)} />
                <small>
                  {albumTotal === null ? 'Type to filter Lidarr albums.' : `${albums.length} of ${albumTotal} loaded.`}
                </small>
              </label>
              <label className={styles.field}>
                <span>Source</span>
                <select value={source} onChange={(event) => setSource(event.target.value)}>
                  {sources.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <small>Used with `rip search --first`.</small>
              </label>
            </div>

            <div
              ref={albumListRef}
              onScroll={maybeLoadMoreAlbums}
              style={{ display: 'grid', gap: 8, maxHeight: 320, overflow: 'auto' }}
            >
              {albums.length === 0 && <p>{loadingAlbums ? 'Loading Lidarr albums...' : 'No Lidarr albums loaded.'}</p>}
              {albums.map((item) => (
                <button
                  key={item.album.id}
                  onClick={() => setSelectedAlbumId(item.album.id)}
                  type="button"
                  style={{
                    textAlign: 'left',
                    padding: 12,
                    borderRadius: 4,
                    border:
                      item.album.id === selectedAlbumId
                        ? '1px solid var(--purple-500)'
                        : '1px solid var(--borderColor)',
                    background: 'var(--inputBackground)',
                    color: 'var(--textColor)'
                  }}
                >
                  <strong>
                    {item.artist?.name ?? 'Unknown artist'} — {item.album.title}
                  </strong>
                  <br />
                  <small>
                    {item.query} · {Math.round(item.album.percentOfTracks ?? 0)}% present
                  </small>
                </button>
              ))}
              {hasMoreAlbums && (
                <button disabled={loadingAlbums} onClick={() => void loadAlbums()} type="button">
                  {loadingAlbums ? 'Loading...' : 'Load more'}
                </button>
              )}
            </div>

            <button
              className={styles.primary}
              disabled={busy || !selectedAlbum}
              onClick={() => void startLidarrDownload()}
              type="button"
            >
              {selectedAlbum ? `Search ${source} and download first match` : 'Select a Lidarr album'}
            </button>
          </section>

          <section className={styles.group}>
            <h3>Recent jobs</h3>
            {jobs.length === 0 && <p>No Streamrip jobs yet.</p>}
            {jobs.map((job) => (
              <article
                key={job.id}
                style={{
                  border: '1px solid var(--borderColor)',
                  borderRadius: 4,
                  padding: 12,
                  background: 'var(--inputBackground)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{job.url ?? `${job.source} search: ${job.query}`}</strong>
                  <Badge
                    tone={
                      job.status === 'completed'
                        ? 'good'
                        : job.status === 'failed'
                          ? 'bad'
                          : job.status === 'running'
                            ? 'purple'
                            : 'neutral'
                    }
                  >
                    {job.status}
                  </Badge>
                </div>
                <small>
                  {job.id}
                  {job.startedAt ? ` · ${new Date(job.startedAt).toLocaleString()}` : ''}
                </small>
                {job.lidarrArtistName && (
                  <p>
                    {job.lidarrArtistName} — {job.lidarrAlbumTitle}
                  </p>
                )}
                {job.error && <p className={styles.error}>{job.error}</p>}
                {job.outputTail && (
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>{job.outputTail}</pre>
                )}
              </article>
            ))}
          </section>
        </div>

        <footer className={styles.modalFooter}>
          {message && <span className={message.startsWith('Could') ? styles.error : undefined}>{message}</span>}
          <button onClick={() => void refreshStatus()} type="button">
            Refresh
          </button>
          <button onClick={onClose} type="button">
            Close
          </button>
        </footer>
      </section>
    </div>
  );
}
