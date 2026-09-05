import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isPublicPushHostname } from "../lib/pushEndpoint.js";
import { resolveOfficeHttpsProfile } from "../scripts/office-https-profile.mjs";

test("accepts real browser push providers without allowing private endpoints", () => {
  for (const hostname of [
    "fcm.googleapis.com",
    "android.googleapis.com",
    "web.push.apple.com",
    "updates.push.services.mozilla.com",
    "notify.windows.com",
  ]) {
    assert.equal(isPublicPushHostname(hostname), true, hostname);
  }
  for (const hostname of [
    "localhost",
    "ozmo.local",
    "127.0.0.1",
    "10.0.0.4",
    "172.16.0.4",
    "192.168.1.196",
    "::1",
    "fc00::1",
    "fd00::1",
    "fe80::1",
  ]) {
    assert.equal(isPublicPushHostname(hostname), false, hostname);
  }
});

test("ships the branded OZMO application shell", async () => {
  const [page, app, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OzmoApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<OzmoApp \/>/);
  assert.match(layout, /OZMO · Content Operations/);
  assert.match(app, /Preparing your workspace/);
  assert.match(app, /Secure first-time setup/);
  assert.match(app, /Every task\. Every client\. Always in rhythm\./);
  assert.match(css, /url\(\"\/ozmo-brand\.png\"\)/);
  assert.doesNotMatch(page, /SkeletonPreview/);
});

test("keeps privileged operations behind server-side role checks", async () => {
  const [
    inventory,
    dashboard,
    settings,
    users,
    manualNotifications,
    clients,
    report,
    app,
  ] = await Promise.all([
    readFile(new URL("../app/api/admin/inventory/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/users/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/admin/notifications/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OzmoApp.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(inventory, /requireAdmin\(request\)/);
  assert.match(clients, /requireUser\(request\)/);
  assert.match(manualNotifications, /requireAdmin\(request\)/);
  assert.match(manualNotifications, /suppressPush: true/);
  assert.match(manualNotifications, /sendPushToUser\(recipient\.id/);
  assert.match(manualNotifications, /no active browser notification subscription/);
  assert.match(dashboard, /requireAdmin\(request\)/);
  assert.match(settings, /requireAdmin\(request\)/);
  assert.match(users, /requireAdmin\(request\)/);
  assert.match(users, /export async function POST\(request: Request\)/);
  assert.match(users, /ensureUniqueIdentity/);
  assert.match(users, /CANNOT_DEACTIVATE_SELF/);
  assert.match(users, /LAST_ADMIN/);
  assert.match(users, /createAuthSession/);
  assert.match(app, /Add profile/);
  assert.match(app, /Optional password reset/);
  assert.match(report, /ACTION_NOT_ALLOWED/);
  assert.match(report, /report_commits/);
  assert.match(report, /inventory_balances/);
  assert.match(report, /CONTENT_UNAVAILABLE/);
});

test("ships the requested roster, schedule, and inventory safety defaults", async () => {
  const database = await readFile(
    new URL("../lib/db.ts", import.meta.url),
    "utf8",
  );
  for (const username of [
    "mwafak",
    "ghaith",
    "yaz",
    "obay",
    "zeid",
    "obeid",
    "abd",
    "jad",
    "alaa",
  ]) {
    assert.match(database, new RegExp(`"${username}"`));
  }
  assert.match(database, /\["first_reminder", "17:15"\]/);
  assert.match(database, /\["second_reminder", "17:25"\]/);
  assert.match(database, /\["manager_escalation", "18:00"\]/);
  assert.match(database, /\["working_days", "\[6,0,1,2,3\]"\]/);
  assert.match(database, /\["inventory_ready", "false"\]/);
  assert.match(database, /CHECK \(quantity >= 0\)/);
});

test("enforces live company and individual report schedules on the server", async () => {
  const [database, schema, settings, reports, notifications] =
    await Promise.all([
      readFile(new URL("../lib/db.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/schedule.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/settings/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/notifications.ts", import.meta.url), "utf8"),
    ]);

  assert.match(database, /CREATE TABLE IF NOT EXISTS user_work_schedules/);
  assert.match(schema, /effectiveWorkDays/);
  assert.match(schema, /currentMinutes >= deadlineMinutes/);
  assert.match(settings, /staffSchedules/);
  assert.match(settings, /requireAdmin\(request\)/);
  assert.match(reports, /REPORT_WINDOW_LOCKED/);
  assert.match(reports, /nextOpenAt/);
  assert.match(notifications, /report_deadline/);
  assert.match(notifications, /effectiveWorkDays/);
});

test("ships repairable background push and a public Android CA download", async () => {
  const [
    push,
    app,
    browserNotifications,
    setup,
    bootstrap,
    startOffice,
    macService,
  ] = await Promise.all([
    readFile(new URL("../lib/push.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/OzmoApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/browserNotifications.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/setup-office-https.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/certificate-bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/start-office.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/mac-office-service.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(push, /mailto:admin@example\.com/);
  assert.match(push, /subject: VAPID_SUBJECT/);
  assert.doesNotMatch(push, /topic: safeTopic/);
  assert.match(app, /Send test/);
  assert.match(app, /http:\/\/192\.168\.1\.196:3001/);
  assert.match(browserNotifications, /endpoint: subscription\.endpoint/);
  assert.match(browserNotifications, /test\.expired/);
  assert.match(browserNotifications, /certificate_untrusted/);
  assert.match(browserNotifications, /serviceWorkerRegistered/);
  assert.match(browserNotifications, /EdgA/);
  assert.match(browserNotifications, /PUSH_ENDPOINT_UNSUPPORTED/);
  assert.match(push, /targetEndpoint/);
  assert.match(setup, /basicConstraints = critical,CA:TRUE/);
  assert.match(setup, /"DER"/);
  assert.match(bootstrap, /ozmo-office-ca-android\.cer/);
  assert.match(bootstrap, /ozmo-office-ca-apple\.mobileconfig/);
  assert.match(bootstrap, /ozmo-office-ca-windows\.cer/);
  assert.match(bootstrap, /Trusted Root Certification Authorities/);
  assert.match(bootstrap, /stableProfileUuid/);
  assert.match(bootstrap, /com\.apple\.security\.root/);
  assert.match(bootstrap, /CA certificate/);
  assert.match(startOffice, /certificate-bootstrap\.mjs/);
  assert.match(startOffice, /stopped unexpectedly/);
  assert.match(macService, /KeepAlive/);
  assert.match(macService, /caffeinate/);
  assert.match(macService, /OZMO_PACKAGE_MANAGER_SCRIPT/);
  assert.match(macService, /Atomics\.wait/);
});

test("preserves submitted data while adding corrections, archives, and soft removal", async () => {
  const [database, reports, archives, history, sessions] = await Promise.all([
    readFile(new URL("../lib/db.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/admin/archives/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/sessions/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(database, /CREATE TABLE IF NOT EXISTS report_corrections/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS activity_log_hides/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS session_deletions/);
  assert.match(database, /CREATE TABLE IF NOT EXISTS inventory_periods/);
  assert.match(database, /WHERE username=\? COLLATE NOCASE OR phone=\?/);
  assert.match(database, /SELECT 1 FROM clients WHERE name=\? COLLATE NOCASE/);
  assert.match(reports, /CORRECTION_TOKEN_USED/);
  assert.match(reports, /is_correction/);
  assert.match(reports, /agency_observation/);
  assert.match(reports, /INVALID_REELS_SHOT/);
  assert.match(archives, /month_close_reset/);
  assert.match(archives, /inventory_period_snapshots/);
  assert.doesNotMatch(archives, /DELETE FROM (?:tasks|reports|inventory_events)/);
  assert.match(history, /INSERT OR IGNORE INTO activity_log_hides/);
  assert.doesNotMatch(history, /DELETE FROM (?:tasks|inventory_events)/);
  assert.match(sessions, /INSERT INTO session_deletions/);
  assert.match(sessions, /reels_shot/);
  assert.doesNotMatch(sessions, /DELETE FROM sessions/);
});

test("exposes the new role-aware and mobile-friendly controls", async () => {
  const [clients, inventory, app, css, browserNotifications] =
    await Promise.all([
      readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/admin/inventory/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/OzmoApp.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
      readFile(
        new URL("../app/browserNotifications.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(clients, /user\.role === "editor"/);
  assert.match(clients, /export async function POST\(request: Request\)/);
  assert.match(clients, /INSERT INTO inventory_balances/);
  assert.match(inventory, /body\?\.reason \?\? ""/);
  assert.match(app, /Add client/);
  assert.match(app, /Month archive/);
  assert.match(app, /Use correction token/);
  assert.match(app, /reels shot/i);
  assert.match(app, /OZMO · Agency-wide/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /100dvh/);
  assert.match(css, /data-label/);
  assert.match(browserNotifications, /reconcileBrowserPushSubscription/);
  assert.match(browserNotifications, /encodeURIComponent\(subscription\.endpoint\)/);
  assert.match(browserNotifications, /updateViaCache: "none"/);
});

test("supports non-client work and reversible client removal without deleting records", async () => {
  const [clients, reports, history, dashboard, notifications, app] =
    await Promise.all([
      readFile(new URL("../app/api/clients/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/reports/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/history/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/notifications.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/OzmoApp.tsx", import.meta.url), "utf8"),
    ]);

  assert.match(clients, /export async function DELETE\(request: Request\)/);
  assert.match(clients, /requireAdmin\(request\)/);
  assert.match(clients, /SET is_active=0/);
  assert.match(clients, /SET is_active=1,ozmo_client_id=\?,session_reel_threshold=/);
  assert.match(clients, /CLIENT_HAS_DRAFT_WORK/);
  assert.match(clients, /CLIENT_HAS_UPCOMING_SESSION/);
  assert.match(clients, /historyPreserved: true/);
  assert.match(clients, /UPDATE notification_states/);
  assert.doesNotMatch(clients, /DELETE FROM clients/i);
  assert.doesNotMatch(clients, /DELETE FROM (?:tasks|inventory_events|sessions)/i);

  assert.match(app, /Other \/ Non-client work · أخرى/);
  assert.match(app, /Remove client/);
  assert.match(app, /Logged only · no inventory change/);
  assert.match(app, /What did you do\? \/ ماذا أنجزت؟/);
  assert.match(reports, /OTHER_REQUIRES_OTHER_TASK/);
  assert.match(reports, /OTHER_DETAILS_REQUIRED/);
  assert.match(reports, /task\.task_type === "other"/);
  assert.match(history, /task\.task_type === "other" \? "Other"/);
  assert.match(dashboard, /c\.is_active=1 AND s\.status='scheduled'/);
  assert.match(notifications, /WHERE c\.is_active=1/);
});

test("ships portable double-click host launchers for macOS and Windows 10", async () => {
  const [
    macLauncher,
    windowsLauncher,
    windows211Launcher,
    windowsSupervisor,
    nodeCheck,
    requiredIpCheck,
    runningCheck,
    hostCheck,
    httpsSetup,
    certificateBootstrap,
    prebuiltCheck,
    windowsDependencies,
    startOffice,
    packageJson,
  ] =
    await Promise.all([
      readFile(
        new URL("../Start OZMO Host - Mac.command", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../Start OZMO Host - Windows 10.bat", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../Start OZMO Host - Windows 10 - 192.168.1.211.bat",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../scripts/windows-office-supervisor.ps1",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../scripts/check-node-version.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/check-required-host-ip.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/check-office-running.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/check-office-host.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/setup-office-https.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/certificate-bootstrap.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/check-prebuilt-dist.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/windows-dependencies.mjs", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../scripts/start-office.mjs", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
    ]);
  const scripts = JSON.parse(packageJson).scripts;

  assert.match(macLauncher, /\$\{0:A:h\}/);
  assert.match(macLauncher, /com\.ozmo\.office\.plist/);
  assert.match(macLauncher, /check-office-running\.mjs/);
  assert.match(macLauncher, /run_pnpm office:https/);
  assert.match(windowsLauncher, /%~dp0/);
  assert.match(windowsLauncher, /node_modules\\\.bin\\wrangler\.cmd/);
  assert.match(windowsLauncher, /check-office-running\.mjs/);
  assert.match(windowsLauncher, /Private networks only/);
  assert.doesNotMatch(windowsLauncher, /OZMO_HTTPS_PROFILE/);
  assert.match(
    windows211Launcher,
    /set "OZMO_OFFICE_IP=192\.168\.1\.211"/,
  );
  assert.match(
    windows211Launcher,
    /set "OZMO_HTTPS_PROFILE=windows-192\.168\.1\.211"/,
  );
  assert.match(
    windows211Launcher,
    /check-required-host-ip\.mjs" "192\.168\.1\.211"/,
  );
  assert.match(
    windows211Launcher,
    /pnpm https:setup[\s\S]+check-office-host\.mjs/,
  );
  assert.match(windows211Launcher, /windows-office-supervisor\.ps1/);
  assert.doesNotMatch(windows211Launcher, /call pnpm office:https/);
  assert.match(
    windows211Launcher,
    /check-prebuilt-dist\.mjs[\s\S]+call pnpm build/,
  );
  assert.match(windows211Launcher, /windows-dependencies\.mjs" check/);
  assert.match(windows211Launcher, /windows-dependencies\.mjs" stamp/);
  assert.match(windows211Launcher, /Private networks only/);
  assert.match(windowsSupervisor, /SetThreadExecutionState/);
  assert.match(windowsSupervisor, /ES_SYSTEM_REQUIRED/);
  assert.match(windowsSupervisor, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(windowsSupervisor, /AssignProcessToJobObject/);
  assert.match(windowsSupervisor, /SetConsoleCtrlHandler/);
  assert.match(windowsSupervisor, /gracefulStopDeadline/);
  assert.match(windowsSupervisor, /host\.lock/);
  assert.match(windowsSupervisor, /20MB/);
  assert.match(windowsSupervisor, /Restarting automatically in/);
  assert.match(windowsSupervisor, /\$restartDelays = @\(2, 4, 8, 16, 30\)/);
  assert.match(windowsSupervisor, /\$rapidFailures -ge 5/);
  assert.match(prebuiltCheck, /__vite_rsc_assets_manifest\.js/);
  assert.match(prebuiltCheck, /validateManifestFiles/);
  assert.match(windowsDependencies, /pnpm-lock\.yaml/);
  assert.match(windowsDependencies, /\.ozmo-windows-install\.json/);
  assert.match(nodeCheck, /22, 13, 0/);
  assert.match(requiredIpCheck, /currentIps\.includes\(expectedIp\)/);
  assert.match(runningCheck, /certificateFingerprint === expectedFingerprint/);
  assert.match(hostCheck, /resolveOfficeHttpsProfile/);
  assert.match(hostCheck, /profileCertificateFiles/);
  assert.match(hostCheck, /certificate copy is incomplete/);
  assert.match(hostCheck, /new X509Certificate/);
  assert.match(hostCheck, /serverCertificate\.checkIP\(savedIp\)/);
  assert.match(hostCheck, /public downloads do not match/);
  assert.match(hostCheck, /currentPrivateIps\.includes\(officeIp\)/);
  assert.match(httpsSetup, /process\.platform === "win32"/);
  assert.match(httpsSetup, /Git", "usr", "bin", "openssl\.exe"/);
  assert.match(httpsSetup, /A named profile cannot create an office authority/);
  assert.match(httpsSetup, /temporaryProfileDirectory/);
  assert.doesNotMatch(httpsSetup, /execFileSync\("\/usr\/bin\/openssl"/);
  assert.match(certificateBootstrap, /profile\.details/);
  assert.match(startOffice, /httpsProfile\.serverCertificate/);
  assert.match(startOffice, /--https-cert-path/);
  assert.equal(scripts.build, "next build");
  assert.equal(scripts["start:lan:https"], undefined);
});

test("isolates the Windows 192.168.1.211 HTTPS profile from the default host", () => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const defaultProfile = resolveOfficeHttpsProfile({
    projectRoot,
    environment: {},
  });
  const windowsProfile = resolveOfficeHttpsProfile({
    projectRoot,
    environment: {
      OZMO_HTTPS_PROFILE: "windows-192.168.1.211",
    },
  });

  assert.equal(defaultProfile.name, "default");
  assert.match(defaultProfile.serverCertificate, /\.certs[\\/]ozmo-office\.pem$/);
  assert.match(
    windowsProfile.serverCertificate,
    /\.certs[\\/]profiles[\\/]windows-192\.168\.1\.211[\\/]server\.pem$/,
  );
  assert.match(
    windowsProfile.details,
    /\.certs[\\/]profiles[\\/]windows-192\.168\.1\.211[\\/]office-https\.json$/,
  );
  assert.equal(windowsProfile.caCertificate, defaultProfile.caCertificate);
  assert.equal(windowsProfile.caKey, defaultProfile.caKey);
  assert.notEqual(
    windowsProfile.serverCertificate,
    defaultProfile.serverCertificate,
  );
  assert.throws(
    () =>
      resolveOfficeHttpsProfile({
        projectRoot,
        environment: { OZMO_HTTPS_PROFILE: "../outside" },
      }),
    /must contain only lowercase/,
  );
});
