# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:22-alpine3.20@sha256:2289fb1fba0f4633b08ec47b94a89c7e20b829fc5679f9b7b298eaa2f1ed8b7e AS deps
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

FROM node:22-alpine3.20@sha256:2289fb1fba0f4633b08ec47b94a89c7e20b829fc5679f9b7b298eaa2f1ed8b7e AS runner
WORKDIR /app

ARG STREAMRIP_PACKAGE=https://github.com/nathom/streamrip/archive/e3291615ba6be34aa76df19da8aeb6f41673c6a0.tar.gz
ARG STREAMRIP_SHA256=88e2026a348ef11025cf7103a7e4f68973f45e656b42edc5becd10af2d4c7fc0

RUN apk add --no-cache --upgrade apache2-utils bash curl docker-cli docker-cli-compose postgresql-client python3 py3-pip rsync sqlite \
    && python3 -m venv /opt/streamrip \
    && /opt/streamrip/bin/python -m pip install --no-cache-dir --upgrade pip \
    && curl --fail --location \
        --retry 5 --retry-all-errors --retry-delay 2 \
        --connect-timeout 20 --max-time 300 \
        --output /tmp/streamrip.tar.gz "${STREAMRIP_PACKAGE}" \
    && echo "${STREAMRIP_SHA256}  /tmp/streamrip.tar.gz" | sha256sum -c \
    && /opt/streamrip/bin/pip install --no-cache-dir --retries 5 --timeout 60 /tmp/streamrip.tar.gz \
    && rm /tmp/streamrip.tar.gz \
    && ln -s /opt/streamrip/bin/rip /usr/local/bin/rip

# Release metadata changes frequently, so keep it after the stable runtime dependency layer.
ARG STACKARR_VERSION=0.3.0-alpha.19 # x-release-please-version
ARG STACKARR_CHANNEL=alpha
ARG STACKARR_REVISION=unknown
ARG STACKARR_TELEMETRY_ENDPOINT=

LABEL org.opencontainers.image.title="Stackarr" \
      org.opencontainers.image.description="[Stackarr](https://stackarr.app/) is a chat-first Docker control plane for self-hosted apps and homelabs." \
      org.opencontainers.image.version="${STACKARR_VERSION}" \
      org.opencontainers.image.revision="${STACKARR_REVISION}" \
      org.opencontainers.image.authors="Stackarr" \
      org.opencontainers.image.licenses="GPL-3.0-only" \
      org.opencontainers.image.vendor="Polyphonic" \
      org.opencontainers.image.source="https://github.com/polyphonic/stackarr" \
      org.opencontainers.image.documentation="https://stackarr.app/docs/installation/docker" \
      org.opencontainers.image.url="https://hub.docker.com/r/polyphonic/stackarr" \
      org.opencontainers.image.logo="https://stackarr.app/icon-512.png" \
      org.opencontainers.image.icon="https://stackarr.app/icon-512.png" \
      com.stackarr.icon="https://stackarr.app/icon-512.png" \
      maintainer="polyphonic"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    STACKARR_VERSION=${STACKARR_VERSION} \
    STACKARR_CHANNEL=${STACKARR_CHANNEL} \
    STACKARR_REVISION=${STACKARR_REVISION} \
    STACKARR_TELEMETRY_ENDPOINT=${STACKARR_TELEMETRY_ENDPOINT} \
    HOSTNAME=0.0.0.0 \
    PORT=7777 \
    STACKARR_WEB_PORT=7777 \
    STACKARR_RUNTIME=docker \
    STACKARR_CONTAINER_NAME=stackarr \
    STACKARR_REPO_ROOT=/stackarr-workspace \
    STACKARR_DATABASE_FILE=/stackarr-workspace/stackarr/config/stackarr.db

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

RUN mkdir -p /stackarr-state /stackarr-config /stackarr-workspace \
    && chown -R node:node /app /opt/streamrip /stackarr-state /stackarr-config /stackarr-workspace

EXPOSE 7777

USER node

CMD ["bash", "stackarr/scripts/container-entrypoint.sh"]
