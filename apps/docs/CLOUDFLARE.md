# Docs deployment

The documentation site runs on Cloudflare Workers using vinext. Cloudflare Workers Builds builds the site from Git. The application's Docker and release workflows remain separate.

## Workers Builds

Use the repository root as the build root:

- Build: `pnpm --filter @stackarr/db build && pnpm --filter @stackarr/docs build:cloudflare`
- Production deploy: `pnpm --filter @stackarr/docs deploy:cloudflare`
- Non-production version upload: `pnpm --filter @stackarr/docs deploy:cloudflare:preview`
- Production branch: `production`; use `preview` for staging.
- Watch: `apps/docs/*`, `packages/cms/*`, `packages/db/*`, `packages/ui/*`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `tsconfig.base.json`.

The preview command uploads an inactive version with a branch alias. It never calls `wrangler deploy`. A build-environment check prevents deploying a preview build as production or vice versa. Append `--dry-run` to either deployment command to validate without publishing.

## Environments

Commit only dotenvx-encrypted values in `src/env/.env.production` and `src/env/.env.preview`. Keep `.env.keys` at the repository root, ignored by Git, and back it up securely. Add `DOTENV_PRIVATE_KEY_PRODUCTION` and `DOTENV_PRIVATE_KEY_PREVIEW` as Cloudflare **build secrets**. Restrict build access to trusted repository branches: anyone who can execute a build with those keys can decrypt the corresponding environment.

The build decrypts only the selected environment and embeds only `NEXT_PUBLIC_*` values as public Worker variables. Deployment transfers the selected server values through Wrangler's secrets file, using a temporary file with owner-only permissions and deleting it afterward. The private decryption key is not included in the Worker or browser bundle.

Edit encrypted values with dotenvx, then run `pnpm --filter @stackarr/docs env:encrypt`. Locally, set `DEPLOYMENT_ENV=preview` before `build:cloudflare` for a preview build. Cloudflare selects the environment from `WORKERS_CI_BRANCH` automatically. Vercel system variables and OIDC tokens must not be migrated.

## Publishing content

Blog pages, feeds, the sitemap, and the blog portion of `llms.txt` are generated at request time. Sanity queries use the published perspective, the origin API, and `cache: 'no-store'`. Publishing, updating, or unpublishing an article therefore does not require a build or a deploy hook. Keep CDN rules from overriding these routes' dynamic cache policy.

Validate a version URL before routing the public domain: homepage, docs navigation, blog, a published article, `/sitemap.xml`, feeds, and discovery routes. Compare the article list against Sanity. Retain the previous host until the custom domain serves the verified Worker.
