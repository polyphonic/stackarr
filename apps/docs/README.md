# Public web app

This Next.js app serves the landing page, documentation, Sanity blog and feeds, agent discovery and Markdown endpoints, downloads, and opt-in telemetry collector. The installed Stackarr dashboard lives in `apps/frontend` and is deployed with the managed Docker runtime.

## Vercel

Import the repository into the intended Vercel team and select `apps/docs` as the root directory. Enable source files outside the root directory, use Node.js 24, and set `production` as the production branch. `vercel.json` installs the pinned workspace package manager, generates the Prisma client, and builds with native Next.js. Feature branches produce preview deployments; production changes go through a pull request.

Configure environment variables separately for Production and Preview before deploying:

- `NEXT_PUBLIC_SITE_URL`: the canonical public URL.
- `NEXT_PUBLIC_SANITY_PROJECT_ID` and `NEXT_PUBLIC_SANITY_DATASET`: the existing published blog.
- `STACKARR_TELEMETRY_COLLECTOR_ENABLED=true` to restore the collector.
- `STACKARR_TELEMETRY_INGEST_KEY`: preserve the existing signing key so installed clients retain valid tokens.
- `DATABASE_URL`: the existing Neon runtime connection; `DIRECT_URL` is used for deliberate migrations. Deployment does not automatically migrate or replace the database.
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`: the existing Upstash Redis REST credentials.
- `NEXT_PUBLIC_STACKARR_TELEMETRY_REGISTRATION_ENABLED=true` if the public registration flow should be shown. This does not opt installations into telemetry.

Store credentials as sensitive Vercel environment variables, never as public variables or committed plaintext. The encrypted files under `src/env` are used by the Cloudflare deployment scripts; Next.js does not decrypt them automatically. Migrate their values with the matching dotenvx private key into Vercel's environment settings. Local development credentials point at local services and must not be copied into cloud deployments.

The collector rejects incomplete configuration and unavailable rate limiting. Registration is limited to 10 requests per hour and ingest to 60 per minute, with HMAC-hashed client identifiers. Vercel keeps Upstash analytics alive with `waitUntil` after returning the rate-limit result.

Before moving the custom domain, verify landing and docs navigation, blog articles/categories/feeds, Open Graph images, Markdown rewrites, discovery routes, download redirects, registration, authenticated event ingestion, and HTTP 429 with retry headers. Use a dedicated test identity and keep the Cloudflare deployment available until Vercel passes these checks. DNS should point directly to Vercel so rate limiting receives individual client addresses.

## Local key custody

Private keys can live in macOS Keychain instead of a plaintext key file. From the repository root, move each key with dotenvx:

```sh
pnpm --filter @stackarr/docs exec dotenvx native up -f src/env/.env.production -fk ../../.env.keys
pnpm --filter @stackarr/docs exec dotenvx native up -f src/env/.env.preview -fk ../../.env.keys
```

The deployment loader supports dotenvx's native secret store, explicit private-key environment variables, and an ignored `.env.keys` file. Run local builds under the same OS user that stored the keys. CI still needs its environment-specific private key in the CI secret store. Storing a private key does not populate empty encrypted application settings; configure the real database and Redis credentials separately.

## Cloudflare fallback

The existing `build:cloudflare`, `deploy:cloudflare`, and preview scripts remain available for rollback. They use encrypted environment files and the matching private key supplied outside Git. Do not enable two production deployment pipelines against the same public domain during cutover.
