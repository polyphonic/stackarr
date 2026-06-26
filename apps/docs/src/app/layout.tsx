import './globals.css';

import { GoogleTagManager } from '@next/third-parties/google';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { githubUrl, googleTagManagerId, siteDescription, siteName, siteUrl } from '~/lib/site';
import { AnalyticsTracker } from './analytics-tracker';
import { WebMCPProvider } from './WebMCPProvider';

const themeInitScript = `
(function () {
  try {
    var key = 'stackarr-theme';
    var root = document.documentElement;
    var stored = window.localStorage.getItem(key) || 'system';
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var resolved =
      mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode;

    root.classList.remove(resolved === 'dark' ? 'light' : 'dark');
    root.classList.add(resolved);
    root.dataset.theme = resolved;
    root.dataset.themeMode = mode;
    root.style.colorScheme = resolved;
  } catch (_) {}
})();
`;

export const metadata: Metadata = {
  applicationName: siteName,
  metadataBase: new URL(siteUrl),
  title: {
    template: '%s | Stackarr',
    default: 'Stackarr - Home Media Server Manager'
  },
  description: siteDescription,
  keywords: [
    'Stackarr',
    'home media server',
    'media server manager',
    'Plex',
    'Jellyfin',
    'Sonarr',
    'Radarr',
    'self-hosted media'
  ],
  alternates: {
    canonical: '/'
  },
  openGraph: {
    title: 'Stackarr - Home Media Server Manager',
    description: siteDescription,
    url: '/',
    siteName,
    type: 'website',
    images: [
      {
        url: '/icon-512.png',
        width: 512,
        height: 512,
        alt: 'Stackarr logo'
      }
    ]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stackarr - Home Media Server Manager',
    description: siteDescription,
    images: ['/icon-512.png']
  },
  robots: {
    index: true,
    follow: true
  },
  icons: {
    icon: '/icon.svg'
  },
  category: 'technology',
  authors: [{ name: 'Stackarr contributors', url: githubUrl }],
  creator: 'Stackarr contributors',
  publisher: 'Stackarr contributors'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f9fc' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1326' }
  ]
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script id="stackarr-theme-init" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <WebMCPProvider />
        {children}
        {googleTagManagerId ? <AnalyticsTracker /> : null}
      </body>
      {googleTagManagerId ? <GoogleTagManager gtmId={googleTagManagerId} /> : null}
    </html>
  );
}
