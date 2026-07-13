import { listServiceFavoritesAction, readSettings, stackarrChannel, stackarrVersion } from '@stackarr/core';
import { getStackarrThemeClass } from '@stackarr/ui/theme';
import { StackarrThemeProvider } from '@stackarr/ui/theme-provider';
import { StackarrToaster } from '@stackarr/ui/toast';
import type { Metadata } from 'next';
import type React from 'react';
import { AppFrame } from '../components/AppFrame';
import { TelemetryHeartbeat } from '../components/TelemetryHeartbeat';

import './globals.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Stackarr',
  description: 'Manage your self-hosted apps and homelab from chat or the Stackarr dashboard.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = readSettings();
  const theme = settings.ui.theme;
  const telemetryEnabled = settings.telemetry.enabled;

  return (
    <html lang="en" className={getStackarrThemeClass(theme)} data-theme={theme} suppressHydrationWarning>
      <body className="bg-background text-foreground" data-theme={theme}>
        <StackarrThemeProvider theme={theme}>
          <TelemetryHeartbeat enabled={telemetryEnabled} />
          <StackarrToaster />
          <AppFrame
            channel={stackarrChannel}
            initialFavorites={listServiceFavoritesAction()}
            setupComplete={settings.setup.onboardingComplete}
            version={stackarrVersion}
          >
            {children}
          </AppFrame>
        </StackarrThemeProvider>
      </body>
    </html>
  );
}
