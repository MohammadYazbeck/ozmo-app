import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses a production Next.js runtime instead of a local Worker preview", async () => {
  const [packageJson, nextConfig, databaseDriver] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sqlite-d1.ts", import.meta.url), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);

  assert.equal(packageData.scripts.build, "next build");
  assert.match(packageData.scripts.start, /^next start/);
  assert.doesNotMatch(packageData.scripts.start, /wrangler dev/);
  assert.match(nextConfig, /output:\s*"standalone"/);
  assert.match(databaseDriver, /from "node:sqlite"/);
  assert.doesNotMatch(databaseDriver, /cloudflare:workers/);
});

test("ships a persistent Hostinger Docker deployment", async () => {
  const [dockerfile, compose, environment, health] = await Promise.all([
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.prod.yml", import.meta.url), "utf8"),
    readFile(new URL("../.env.production.example", import.meta.url), "utf8"),
    readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(dockerfile, /node:22-bookworm-slim/);
  assert.match(dockerfile, /\.next\/standalone/);
  assert.match(compose, /ozmo-app-data:\/app\/data/);
  assert.match(compose, /traefik\.http\.routers\.ozmo-app/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(environment, /OZMO_SCHEDULER_KEY=/);
  assert.match(health, /ensureDatabase\(\)/);
});

test("assigns a stable shared OZMO identifier to every client", async () => {
  const [database, clientRoute] = await Promise.all([
    readFile(new URL("../lib/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(database, /\["OZMO-0007", "BURGASM"\]/);
  assert.match(database, /clients_ozmo_client_id_unique/);
  assert.match(database, /nextOzmoClientId/);
  assert.match(clientRoute, /ozmoClientId: client\.ozmo_client_id/);
  assert.match(clientRoute, /INSERT INTO clients \(ozmo_client_id,name/);
});

test("stores authenticated client PNG branding and surfaces it in both apps", async () => {
  const [database, uploadRoute, logoRoute, summary, staffUi, portalUi] = await Promise.all([
    readFile(new URL("../lib/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/client-logo/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/client-logo/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OzmoApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portal/ClientPortal.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(database, /CREATE TABLE IF NOT EXISTS client_logos/);
  assert.match(database, /png BLOB NOT NULL/);
  assert.match(uploadRoute, /requireAdmin\(request\)/);
  assert.match(uploadRoute, /MAX_LOGO_BYTES = 2 \* 1024 \* 1024/);
  assert.match(uploadRoute, /PNG_SIGNATURE/);
  assert.match(logoRoute, /portalUser\.clientId !== requestedClientId/);
  assert.match(logoRoute, /Content-Type": "image\/png/);
  assert.match(
    await readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    /pathname !== "\/api\/client-logo"/,
  );
  assert.match(summary, /logoUrl:/);
  assert.match(staffUi, /Portal logo/);
  assert.match(portalUi, /function ClientMark/);
});

test("isolates the client portal from staff data and trusts the session client", async () => {
  const [proxy, summary, accounting, invoice, portalAuth] = await Promise.all([
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/accounting/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/portal/invoice/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/portal-auth.ts", import.meta.url), "utf8"),
  ]);

  assert.match(proxy, /OZMO_PORTAL_HOSTS/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(proxy, /pathname\.startsWith\("\/api\/portal\/"\)/);
  assert.match(summary, /requirePortalUser\(request\)/);
  assert.doesNotMatch(summary, /searchParams\.get\("client/);
  assert.match(accounting, /"X-OZMO-Client-ID": user\.ozmoClientId/);
  assert.match(accounting, /Authorization: `Bearer \$\{token\}`/);
  assert.match(invoice, /requirePortalUser\(request\)/);
  assert.match(portalAuth, /ozmo_portal_session/);
  assert.match(portalAuth, /SameSite/);
  assert.match(portalAuth, /MAX_LOGIN_ATTEMPTS = 5/);
});

test("ships a safe legacy D1 import path", async () => {
  const [packageJson, importer] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/import-d1-database.mjs", import.meta.url), "utf8"),
  ]);
  const packageData = JSON.parse(packageJson);

  assert.equal(packageData.scripts["db:import:d1"], "node scripts/import-d1-database.mjs");
  assert.match(importer, /PRAGMA integrity_check/);
  assert.match(importer, /refusing to overwrite/);
  assert.match(importer, /await backup\(sourceDatabase, destination\)/);
});
