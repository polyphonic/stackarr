import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const serverEnv = createEnv({
  server: {
    STACKARR_CLOUD_DATABASE_URL: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    DIRECT_URL: z.string().min(1).optional(),
    SHADOW_DATABASE_URL: z.string().min(1).optional()
  },
  experimental__runtimeEnv: process.env,
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true
});

export function getDatabaseUrl() {
  return serverEnv.STACKARR_CLOUD_DATABASE_URL || serverEnv.DATABASE_URL || '';
}

export function requireDatabaseUrl() {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new Error('STACKARR_CLOUD_DATABASE_URL or DATABASE_URL is required when the telemetry collector is enabled.');
  }

  return databaseUrl;
}
