import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .default('false')
  .transform((value) => /^(1|true|yes|on)$/i.test(value));

export const clientEnv = createEnv({
  client: {
    NEXT_PUBLIC_STACKARR_TELEMETRY_REGISTRATION_ENABLED: booleanString,
    NEXT_PUBLIC_STACKARR_VERSION: z.string().min(1).default('0.3.0-alpha.9') // x-release-please-version
  },
  runtimeEnv: {
    NEXT_PUBLIC_STACKARR_TELEMETRY_REGISTRATION_ENABLED:
      process.env.NEXT_PUBLIC_STACKARR_TELEMETRY_REGISTRATION_ENABLED,
    NEXT_PUBLIC_STACKARR_VERSION: process.env.NEXT_PUBLIC_STACKARR_VERSION
  },
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true
});
