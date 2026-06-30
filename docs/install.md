# Stackarr Installation

Stackarr follows the arr convention of a browser UI on a fixed port with API-key access under `/api/v1`.
The default dashboard/API port is `7777`; set `STACKARR_WEB_PORT` if that port is already in use.
For this alpha release the supported install targets are macOS and Docker.

## macOS

Use macOS when Plex or Jellyfin already run natively and you want Stackarr to monitor and configure the rest of the stack around them.
Intel and Apple Silicon archives are labelled separately for release downloads.
Alpha archives are generated from the same Next.js standalone server:

```bash
pnpm package:macos
```

```bash
corepack enable
pnpm install
pnpm build
pnpm dev
```

Open `http://localhost:7777` and run the setup wizard. Choose `native` for Plex or Jellyfin when the media server is already installed outside Docker.

## Docker

Docker is the preferred install when Stackarr should run beside the services it manages.

```bash
docker run -d \
  --name stackarr \
  --restart unless-stopped \
  -p 7777:7777 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$PWD:/stackarr-workspace" \
  -e STACKARR_REPO_ROOT=/stackarr-workspace \
  -e STACKARR_DATABASE_FILE=/stackarr-workspace/stackarr/config/stackarr.db \
  polyphonic/stackarr:alpha
```

To run it as part of the managed compose group, advanced Docker users can set these Compose variables:

```dotenv
STACKARR_WEB_ENABLED="true"
STACKARR_IMAGE="polyphonic/stackarr:alpha"
STACKARR_BIND_IP="127.0.0.1"
STACKARR_WEB_PORT="7777"
```

Then start only the Stackarr service:

```bash
docker compose -f stackarr/docker-compose.yml --profile stackarr up -d stackarr
```

The Docker socket mount is intentionally explicit. It allows Stackarr to queue arr-style commands that control the local compose stack. Keep `STACKARR_BIND_IP` on `127.0.0.1` until authentication, Cloudflare, and public URL settings are configured.

Choose media, music, downloads, and backup folders during setup. On macOS, share those selected folders with Docker Desktop or OrbStack, then run **System > Status > Audit permissions** or:

```bash
docker exec stackarr /app/bin/stackarr permissions audit
```

The audit checks Stackarr and running service containers through their actual bind mounts. Scheduled backups and optional scheduled updates run from the Stackarr container, so the Docker install does not require Watchtower, Portainer, or host launch agents for those jobs.

### Portless service names

The dashboard can switch service links to Portless aliases, but a Dockerized Stackarr app cannot install host launch agents, bind host port `443`, trust certificates, or edit `/etc/hosts` by itself.

For end users, the intended flow is:

```bash
stackarr portless install
```

Run that command from Terminal after enabling `portless` in **Settings > UI > Service Link Mode**. Approve the macOS admin prompts so names like `https://app.stackarr`, `https://plex.stackarr`, and `https://sonarr4k.stackarr` resolve without a port suffix.

Installing Portless globally first is optional. If it already exists, Stackarr reuses it; otherwise the host command installs Portless with npm before registering Stackarr aliases. Source checkouts can run `bin/stackarr portless install`. macOS app archives include a `stackarr` helper next to `Stackarr.app`; if the app has been moved to Applications, the bundled helper is `/Applications/Stackarr.app/Contents/MacOS/Stackarr`.

If the dashboard shows the Portless task as blocked, it is waiting for this host approval step. Open normal Terminal, run the command above, and enter the Mac password there.

Stackarr's scheduled updater runs a maintenance container after successful updates:

```bash
docker compose -f stackarr/docker-compose.yml --profile maintenance run --rm image-cleanup
```

It only removes dangling images left behind by image refreshes.

## Release tags

Stackarr follows prerelease semver tags until the app is production-ready:

```bash
docker pull polyphonic/stackarr:0.3.0-alpha.1
docker pull polyphonic/stackarr:alpha
```

Do not use a `latest` tag until Stackarr has a stable release channel.

## Landing And Docs

The public landing page and docs live in one Fumadocs-backed deployable app:

```bash
pnpm --filter @stackarr/docs build
```

Run `pnpm dev:docs` locally when editing; it uses the normal Next.js development port. Production domains should be assigned by the deployment platform.

## Agent Mode

Stackarr ships a local stdio MCP server for trusted personal agents. Packaged installs expose it through the Stackarr executable:

```bash
stackarr mcp serve
```

Install or export local agent integrations from the same executable:

```bash
stackarr plugins install hermes
stackarr plugins install openclaw
# or both during onboarding / agent setup:
stackarr plugins install all
```

Agents should begin with `stackarr_get_setup_profile`, then use `stackarr_setup_media_server` in dry-run mode before applying changes. The setup profile can include `agentPluginIntegrations: ["hermes", "openclaw"]` so first-run onboarding installs the selected plugins automatically. The MCP server deliberately exposes typed Stackarr actions rather than a generic shell; destructive actions require explicit confirmation flags. Keep the MCP transport local and do not expose it over the public internet.

See `docs/mcp.md` for Hermes/OpenClaw configuration examples and the safety model.
