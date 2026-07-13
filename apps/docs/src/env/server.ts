import { serverEnv as database } from '@stackarr/db/env';
import { vercel } from '@t3-oss/env-core/presets-zod';
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .default('false')
  .transform((value) => /^(1|true|yes|on)$/i.test(value));

export const env = createEnv({
  extends: [vercel(), database],
  shared: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development')
  },
  server: {
    STACKARR_TELEMETRY_COLLECTOR_ENABLED: booleanString,
    STACKARR_TELEMETRY_INGEST_KEY: z.string().min(32).optional(),
    STACKARR_TELEMETRY_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(16_384)
  },
  experimental__runtimeEnv: process.env,
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true
});

export function getTelemetryCollectorConfig() {
  if (!env.STACKARR_TELEMETRY_COLLECTOR_ENABLED) {
    return { enabled: false as const };
  }

  if (!env.STACKARR_TELEMETRY_INGEST_KEY) {
    throw new Error('STACKARR_TELEMETRY_INGEST_KEY is required when telemetry collector is enabled.');
  }

  const databaseUrl = env.STACKARR_CLOUD_DATABASE_URL || env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('STACKARR_CLOUD_DATABASE_URL or DATABASE_URL is required when telemetry collector is enabled.');
  }

  return {
    enabled: true as const,
    ingestKey: env.STACKARR_TELEMETRY_INGEST_KEY,
    maxPayloadBytes: env.STACKARR_TELEMETRY_MAX_PAYLOAD_BYTES
  };
}
