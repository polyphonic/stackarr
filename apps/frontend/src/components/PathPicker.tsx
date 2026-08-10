'use client';

import { useEffect, useMemo, useState } from 'react';
import { stackarrFetch } from './clientApi';
import { icons } from './icons';
import styles from './PathPicker.module.css';

type DirectoryEntry = {
  name: string;
  path: string;
  readable: boolean;
};

type DirectoryRoot = {
  label: string;
  path: string;
};

type DirectoryResponse = {
  path: string;
  parent: string;
  roots: DirectoryRoot[];
  entries: DirectoryEntry[];
  error?: string;
};

export function PathInput({
  value,
  onChange,
  placeholder,
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState(value || '/');
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selectedPath = directory?.path ?? browsePath;
  const roots = useMemo(() => directory?.roots ?? [], [directory]);
  const DriveIcon = icons.drive;

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;
    setLoading(true);
    setError('');

    stackarrFetch(`/api/v1/system/directories?path=${encodeURIComponent(browsePath)}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as DirectoryResponse;

        if (!active) {
          return;
        }

        if (!response.ok) {
          setError(body.error || 'Could not read directory.');
        }

        setDirectory(body);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not read directory.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [browsePath, open]);

  function openPicker() {
    if (disabled) return;
    setBrowsePath(value || '/');
    setOpen(true);
  }

  function choose(path: string) {
    setBrowsePath(path);
  }

  function useCurrentPath() {
    onChange(selectedPath);
    setOpen(false);
  }

  return (
    <>
      <div className={styles.inputGroup}>
        <input
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button disabled={disabled} onClick={openPicker} type="button">
          <DriveIcon size={15} />
          <span>Browse</span>
        </button>
      </div>

      {open && (
        <div className={styles.overlay} role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            aria-labelledby="path-picker-title"
            aria-modal="true"
            className={styles.modal}
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.header}>
              <div>
                <h2 id="path-picker-title">Choose Folder</h2>
                <p>{selectedPath}</p>
              </div>
              <button aria-label="Close folder picker" onClick={() => setOpen(false)} type="button">
                x
              </button>
            </header>

            <div className={styles.body}>
              <div className={styles.roots}>
                {roots.map((root) => (
                  <button
                    className={root.path === selectedPath ? styles.selectedRoot : ''}
                    key={root.path}
                    onClick={() => choose(root.path)}
                    type="button"
                  >
                    <span>{root.label}</span>
                    <small>{root.path}</small>
                  </button>
                ))}
              </div>

              <div className={styles.browser}>
                <div className={styles.browserToolbar}>
                  <button
                    disabled={!directory?.parent}
                    onClick={() => directory?.parent && choose(directory.parent)}
                    type="button"
                  >
                    Up
                  </button>
                  <input value={browsePath} onChange={(event) => setBrowsePath(event.target.value)} />
                </div>

                {loading && <p className={styles.note}>Loading...</p>}
                {error && <p className={styles.error}>{error}</p>}
                {!loading && !error && directory?.entries.length === 0 && (
                  <p className={styles.note}>No folders here.</p>
                )}

                <div className={styles.entries}>
                  {(directory?.entries ?? []).map((entry) => (
                    <button
                      disabled={!entry.readable}
                      key={entry.path}
                      onClick={() => choose(entry.path)}
                      type="button"
                    >
                      <span>{entry.name}</span>
                      {!entry.readable && <small>Not readable</small>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <footer className={styles.footer}>
              <button onClick={() => setOpen(false)} type="button">
                Cancel
              </button>
              <button className={styles.primary} onClick={useCurrentPath} type="button">
                Use This Folder
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
