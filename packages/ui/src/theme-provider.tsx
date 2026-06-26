'use client';

import { type ReactNode, useEffect } from 'react';
import { type StackarrTheme } from './theme';

export { getStackarrThemeClass, type StackarrTheme } from './theme';

function resolveTheme(theme: StackarrTheme): 'light' | 'dark' {
  if (theme !== 'system') {
    return theme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyStackarrDocumentTheme(theme: StackarrTheme) {
  const resolvedTheme = resolveTheme(theme);
  const root = document.documentElement;

  root.dataset.theme = theme;
  document.body.dataset.theme = theme;
  root.classList.toggle('light', resolvedTheme === 'light');
  root.classList.toggle('dark', resolvedTheme === 'dark');
  root.style.colorScheme = resolvedTheme;
  document.body.style.colorScheme = resolvedTheme;
}

export function StackarrThemeProvider({ children, theme }: { children: ReactNode; theme: StackarrTheme }) {
  useEffect(() => {
    applyStackarrDocumentTheme(theme);

    if (theme !== 'system') {
      return undefined;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => applyStackarrDocumentTheme(theme);

    media.addEventListener('change', handleSystemThemeChange);
    return () => media.removeEventListener('change', handleSystemThemeChange);
  }, [theme]);

  return children;
}
