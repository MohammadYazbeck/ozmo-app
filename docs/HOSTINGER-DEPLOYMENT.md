# Hostinger Ubuntu deployment

This deployment runs the staff application and client portal from one image,
while keeping eco as a separate service. Traefik terminates HTTPS and routes two
hostnames to the same OZMO container.

## 1. Prerequisites

- Ubuntu server with Docker Engine and the Docker Compose plugin.
- The existing Traefik proxy and its external Docker network named `web`.
- DNS A/AAAA records for `team.ozmo.media` and `portal.ozmo.media` pointing to
  the server.
- A private repository or another secure way to copy this project to the server.

Confirm the shared proxy network exists:

```bash
docker network inspect web
```

If eco uses a differently named external network or certificate resolver, change
`docker-compose.prod.yml` before deploying.

## 2. Configure secrets and hosts

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`:

- Set `APP_DOMAIN` and `PORTAL_DOMAIN` to the real DNS names.
- Include the staff domain and `web` in `OZMO_TRUSTED_HOSTS`.
- Include only portal domain names in `OZMO_PORTAL_HOSTS`.
- Generate a long random `OZMO_SCHEDULER_KEY`.
- Set `ECO_API_URL` to eco's HTTPS origin.
- Set `ECO_API_TOKEN` to the same dedicated token later configured in eco.

Do not reuse the scheduler key as the eco API token.

## 3. Import the current OZMO data once

Stop the old OZMO host first so the database no longer changes. Copy its main
`.sqlite` file and, if present, its matching `.sqlite-wal` and `.sqlite-shm`
files together. Rename the main file to `migration/ozmo.sqlite` and preserve the
sidecar suffixes:

```text
migration/ozmo.sqlite
migration/ozmo.sqlite-wal
migration/ozmo.sqlite-shm
```

Build the image, then run the guarded one-time importer:

```bash
mkdir -p migration
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

The importer checks integrity and refuses to overwrite an existing destination.
Do not delete the original database or its backups after migration. If this is a
brand-new installation, skip the import; OZMO creates a fresh database on first
start.

## 4. Start and verify

```bash
docker compose -f docker-compose.prod.yml up -d web scheduler
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=150 web scheduler
```

Verify:

```bash
curl -fsS https://team.ozmo.media/api/health
curl -I https://portal.ozmo.media/
```

The health response must report `ok: true`. The portal hostname root should load
the portal, and a staff endpoint such as `/api/setup/status` should return 404 on
the portal hostname.

Sign in to the staff app and verify the clients, reports, inventory and sessions
before inviting any client. Then use **Clients → Create or reset portal access**
to issue a unique client login, and **Clients → Portal logo** to upload the
client's PNG branding. Confirm the logo appears after signing in to that
client's portal. The logo is part of the SQLite database backup.

## 5. Protect staff access

Both applications have authentication, but the staff hostname should also sit
behind an access gateway such as Cloudflare Access, a VPN, or a Traefik IP/access
middleware. Apply that restriction only to the staff router; clients must still
reach the portal router. Do not expose container port 3000 directly in the
firewall.

## 6. Backups

Create a consistent SQLite backup while the service is running:

```bash
docker compose -f docker-compose.prod.yml exec web node scripts/backup-database.mjs
```

This creates a dated file under `/app/data/backups` in the persistent volume.
Copy backups to separate server or object storage; a backup kept only on the same
disk is not sufficient. Test restoring a backup before treating the deployment
as complete.

## 7. Updates and rollback

Before every update, create a database backup. Then:

```bash
docker compose -f docker-compose.prod.yml build web
docker compose -f docker-compose.prod.yml up -d web scheduler
docker compose -f docker-compose.prod.yml logs --tail=150 web scheduler
```

For application rollback, deploy the previous image while leaving the data
volume in place. For database rollback, stop both services and restore a verified
backup only after retaining a copy of the current database.

## 8. eco connection

The portal remains useful before eco is connected: content and sessions come
from OZMO, while billing displays an unavailable state. Implement and test the
two endpoints in [the eco API contract](ECO-API-CONTRACT.md), then set matching
`ECO_API_TOKEN` values and restart OZMO.
