import { readEnv, readSettings } from '@stackarr/core';
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
  description: 'Arr-style control plane for a macOS media server stack.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = readSettings();
  const env = readEnv();
  const theme = settings.ui.theme;
  const telemetryEnabled =
    settings.telemetry.enabled && /^(1|true|yes|on)$/i.test(env.STACKARR_TELEMETRY_FEATURE_ENABLED);

  return (
    <html lang="en" className={getStackarrThemeClass(theme)} data-theme={theme} suppressHydrationWarning>
      <body className="bg-background text-foreground" data-theme={theme}>
        <StackarrThemeProvider theme={theme}>
          <TelemetryHeartbeat enabled={telemetryEnabled} />
          <StackarrToaster />
          <AppFrame setupComplete={settings.setup.onboardingComplete}>{children}</AppFrame>
        </StackarrThemeProvider>
      </body>
    </html>
  );
}
