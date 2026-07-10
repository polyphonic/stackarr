# Install Stackarr

Stackarr is distributed as a Docker image and the supplied Compose file is the supported installation path.

## Requirements

- Docker Engine or Docker Desktop with Compose v2
- permission to use the Docker socket
- host folders for media, downloads, and backups

## Start the app

```bash
mkdir -p stackarr && cd stackarr
curl -fsSL https://stackarr.app/docker-compose.yml -o docker-compose.yml
docker compose --profile stackarr up -d app
```

Open `http://127.0.0.1:7777/setup`.

Stackarr creates `.stackarr/config`, `.stackarr/state`, `.stackarr/logs`, `.stackarr/media`, `.stackarr/downloads`, and `.stackarr/backups` beside the Compose file unless custom paths are configured.

## Configure storage

Put overrides in `.env` beside `docker-compose.yml`:

```dotenv
TIMEZONE=Etc/UTC
MEDIA_ROOT=/srv/media
DOWNLOADS_ROOT=/srv/downloads
BACKUP_ROOT=/srv/backups
STACKARR_BIND_IP=127.0.0.1
STACKARR_WEB_PORT=7777
```

Then recreate the app:

```bash
docker compose --profile stackarr up -d app
```

## Verify

```bash
docker compose ps app
docker compose logs --tail=100 app
docker exec app /app/bin/stackarr permissions audit
```

## Update

```bash
docker compose pull app
docker compose --profile stackarr up -d app
```

For the complete product guide, see [Install Stackarr](https://stackarr.app/docs/installation).
