'use client';

import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <RootProvider
      theme={{
        enabled: false,
        attribute: 'class',
        defaultTheme: 'system',
        enableSystem: true
      }}
    >
      {children}
    </RootProvider>
  );
}
