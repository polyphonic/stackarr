'use client';

import { useEffect } from 'react';

export function TelemetryHeartbeat({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    fetch('/api/v1/telemetry/heartbeat', { method: 'POST', keepalive: true }).catch(() => undefined);
  }, [enabled]);

  return null;
}
