'use client';

import { Surface } from '@stackarr/ui';

export function LandingCodeBlock({ children }: { children: string }) {
  return (
    <Surface className="landingCodeSurface" variant="default">
      <pre>
        <code>{children}</code>
      </pre>
    </Surface>
  );
}
