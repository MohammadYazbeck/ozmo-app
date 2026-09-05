# OZMO Operations + Client Portal

OZMO is now one production Next.js application with two separate surfaces:

- `team.ozmo.media` — the existing staff operations application.
- `portal.ozmo.media` — the client portal for content, sessions and billing.

Both use the same OZMO SQLite database. Client content is read locally; billing
is fetched server-to-server from eco, so the eco API token is never sent to a
browser. Each client has a permanent shared identifier such as `OZMO-0007`.

## Current integration status

- Staff operations, reports, inventory, sessions and reminders are preserved.
- Client login and a client-scoped portal are implemented.
- Real content activity and session data are shown in the portal.
- The eco adapter and invoice proxy are implemented in this project.
- The two matching read-only endpoints still need to be added to eco before
  billing becomes available. Until then the portal shows accounting as not
  connected and does not invent values.

## Local development

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

The staff app is available at `http://localhost:3000`; the portal is at
`http://localhost:3000/portal`.

On the first staff launch, choose an administrator and set the initial password.
In **Clients**, an administrator can create or reset portal access for each
client and upload its portal logo. Logos must be PNG files no larger than 2 MB;
they are stored in the same SQLite database and are included in normal backups.
There are no default client passwords.

## Environment

Copy `.env.production.example` to `.env.production` and replace every placeholder
secret. `OZMO_SCHEDULER_KEY` and `ECO_API_TOKEN` must be different long random
values. Keep `.env.production` off Git.

The portal does not accept a client ID from the browser. It takes the client from
the authenticated portal session and sends only the corresponding
`X-OZMO-Client-ID` to eco.

## Production deployment

The production image uses standard Next.js standalone output and Node's SQLite
driver. Data lives in the `ozmo-app-data` Docker volume, outside the container
layer.

See [Hostinger deployment](docs/HOSTINGER-DEPLOYMENT.md) for DNS, Traefik,
database migration, startup, backup and rollback instructions.

See [eco API contract](docs/ECO-API-CONTRACT.md) for the two endpoints eco must
provide.

## Existing database migration

Inspect a copied Cloudflare D1/SQLite database without changing it:

```bash
npm run db:import:d1 -- --inspect path/to/database.sqlite
```

Import to a new file:

```bash
npm run db:import:d1 -- --import path/to/database.sqlite --to data/ozmo.sqlite
```

The importer checks SQLite integrity, checks that this is an OZMO database and
refuses to overwrite an existing destination. Keep the `.sqlite-wal` and
`.sqlite-shm` files beside the source `.sqlite` when they exist.

Create an online-safe backup:

```bash
npm run db:backup
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The former private-LAN launch notes remain in
[LOCAL_OFFICE_SETUP.md](LOCAL_OFFICE_SETUP.md) for historical reference. The
Docker deployment is the current production path.
