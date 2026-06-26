# syntax=docker/dockerfile:1

FROM node:22-alpine3.20 AS deps
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/mcp/package.json packages/mcp/package.json
RUN pnpm install --filter @stackarr/frontend... --filter @stackarr/mcp... --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY apps/frontend apps/frontend
COPY packages/core packages/core
COPY packages/ui packages/ui
COPY packages/mcp packages/mcp
COPY packages/cli packages/cli
COPY packages/agent-plugins packages/agent-plugins
COPY stackarr stackarr
COPY bin bin
COPY Logo Logo
COPY skills skills
RUN pnpm --dir packages/mcp build
RUN pnpm --dir apps/frontend build

FROM node:22-alpine3.20 AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="Stackarr" \
      org.opencontainers.image.description="Arr-style alpha control plane for a macOS and Docker media server stack." \
      org.opencontainers.image.version="0.3.0-alpha.1" \
      org.opencontainers.image.vendor="Polyphonic" \
      org.opencontainers.image.source="https://github.com/stackarr/stackarr" \
      org.opencontainers.image.documentation="https://github.com/stackarr/stackarr/blob/main/docs/install.md" \
      org.opencontainers.image.url="https://github.com/stackarr/stackarr" \
      org.opencontainers.image.logo="https://raw.githubusercontent.com/stackarr/stackarr/main/Logo/stackarr-512.png" \
      org.opencontainers.image.icon="https://raw.githubusercontent.com/stackarr/stackarr/main/Logo/stackarr-512.png" \
      com.stackarr.icon="https://raw.githubusercontent.com/stackarr/stackarr/main/Logo/stackarr-512.png" \
      maintainer="polyphonic"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    HOSTNAME=0.0.0.0 \
    PORT=7777 \
    STACKARR_WEB_PORT=7777 \
    STACKARR_REPO_ROOT=/stackarr-workspace \
    STACKARR_DATABASE_FILE=/stackarr-workspace/stackarr/config/stackarr.db

ARG STREAMRIP_PACKAGE=https://github.com/nathom/streamrip/archive/refs/heads/dev.tar.gz

RUN apk add --no-cache --upgrade bash curl docker-cli docker-cli-compose postgresql-client python3 py3-pip rsync sqlite \
    && python3 -m venv /opt/streamrip \
    && /opt/streamrip/bin/python -m pip install --no-cache-dir --upgrade pip \
    && /opt/streamrip/bin/pip install --no-cache-dir "${STREAMRIP_PACKAGE}" \
    && ln -s /opt/streamrip/bin/rip /usr/local/bin/rip

COPY --from=builder /app/apps/frontend/.next/standalone ./
COPY --from=builder /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder /app/apps/frontend/public ./apps/frontend/public
COPY --from=builder /app/apps/frontend/public/icon.svg ./icon.svg
COPY --from=builder /app/apps/frontend/public/icon-512.png ./icon-512.png
COPY --from=builder /app/Logo ./Logo
COPY --from=builder /app/stackarr ./stackarr
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/packages/core ./packages/core
COPY --from=builder /app/packages/ui ./packages/ui
COPY --from=builder /app/packages/cli ./packages/cli
COPY --from=builder /app/packages/mcp ./packages/mcp
COPY --from=builder /app/packages/agent-plugins ./packages/agent-plugins
COPY --from=builder /app/skills ./skills

EXPOSE 7777

CMD ["node", "apps/frontend/server.js"]
