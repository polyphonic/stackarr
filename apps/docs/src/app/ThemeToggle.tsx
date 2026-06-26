'use client';

import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import styles from './ThemeToggle.module.css';

type ThemeMode = 'system' | 'light' | 'dark';

const storageKey = 'stackarr-theme';
const modes: ThemeMode[] = ['system', 'light', 'dark'];
const labels: Record<ThemeMode, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark'
};

function normalizeMode(value: string | null): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function applyTheme(mode: ThemeMode) {
  const resolved =
    mode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : mode;
  const root = document.documentElement;

  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  root.style.colorScheme = resolved;
}

export function ThemeToggle({
  className,
  mode: _fumadocsMode,
  ...props
}: ComponentProps<'div'> & { mode?: 'light-dark' | 'light-dark-system' }) {
  const [mode, setMode] = useState<ThemeMode>('system');

  useEffect(() => {
    setMode(normalizeMode(window.localStorage.getItem(storageKey)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, mode);
    applyTheme(mode);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (mode === 'system') {
        applyTheme('system');
      }
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
  }, [mode]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        setMode(normalizeMode(event.newValue));
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const nextMode = modes[(modes.indexOf(mode) + 1) % modes.length] ?? 'system';

  return (
    <div className={`${className ?? ''} ${styles.container}`} {...props}>
      <button
        type="button"
        className={styles.toggle}
        aria-label={`Theme is ${labels[mode]}. Switch to ${labels[nextMode]}.`}
        onClick={() => setMode(nextMode)}
      >
        <span className={styles.track} aria-hidden="true">
          <span className={`${styles.dot} ${styles[mode]}`} />
        </span>
        <span className={styles.label}>{labels[mode]}</span>
      </button>
    </div>
  );
}
