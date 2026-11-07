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

Store credentials as sensitive Vercel environment variables, never as public variables or committed plaintext. The tracked encrypted files under `src/env` are retained only as historical custody during migration; the Next.js deployment does not decrypt or use them. Transfer production values to Vercel through an approved secret-management process without committing plaintext or copying local-development credentials into cloud deployments. Retire the encrypted snapshots and their keys only after the owner verifies custody and migration separately.

The collector rejects incomplete configuration and unavailable rate limiting. Registration is limited to 10 requests per hour and ingest to 60 per minute, with HMAC-hashed client identifiers. Vercel keeps Upstash analytics alive with `waitUntil` after returning the rate-limit result.

Before moving the custom domain, verify landing and docs navigation, blog articles/categories/feeds, Open Graph images, Markdown rewrites, discovery routes, download redirects, registration, authenticated event ingestion, and HTTP 429 with retry headers. Use a dedicated test identity. DNS should point directly to Vercel so rate limiting receives individual client addresses. This public site hosting is separate from customers' optional Stackarr-managed Cloudflare tunnel, DNS, and Access routes.

## Historical encrypted file custody

The former Cloudflare deployment's encrypted `src/env/.env.production` and `src/env/.env.preview` remain tracked for deliberate owner review. Keep any corresponding private keys in secure storage, never commit `.env.keys`, and do not treat these snapshots as Vercel configuration. The Cloudflare site deployment scripts and fallback pipeline have been removed; customer-managed Cloudflare routing remains supported.
