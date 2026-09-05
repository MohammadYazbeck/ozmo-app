import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

if (process.platform !== "darwin") {
  console.error("The OZMO launch service installer is only for macOS.");
  process.exit(1);
}

const action = process.argv[2] || "install";
const label = "com.ozmo.office";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const launchAgentsDirectory = resolve(homedir(), "Library/LaunchAgents");
const launchAgentPath = resolve(launchAgentsDirectory, `${label}.plist`);
const logDirectory = resolve(projectRoot, ".wrangler");
const logPath = resolve(logDirectory, "ozmo-office-service.log");
const userDomain = `gui/${process.getuid()}`;
const serviceDomain = `${userDomain}/${label}`;
const packageManagerPath = findPackageManagerScript();
const runtimePath = [
  dirname(process.execPath),
  dirname(packageManagerPath),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

if (action === "status") {
  execFileSync("/bin/launchctl", ["print", serviceDomain], {
    stdio: "inherit",
  });
  process.exit(0);
}

if (action === "uninstall") {
  try {
    execFileSync("/bin/launchctl", ["bootout", serviceDomain], {
      stdio: "ignore",
    });
  } catch {
    // The service may already be stopped.
  }
  if (existsSync(launchAgentPath)) unlinkSync(launchAgentPath);
  console.log("OZMO automatic office service removed.");
  process.exit(0);
}

if (action !== "install") {
  console.error("Use install, status, or uninstall.");
  process.exit(1);
}

mkdirSync(launchAgentsDirectory, { recursive: true });
mkdirSync(logDirectory, { recursive: true });
writeFileSync(
  launchAgentPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string>
    <string>-s</string>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(resolve(projectRoot, "scripts/start-office.mjs"))}</string>
    <string>--https</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(projectRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
	  <key>PATH</key>
	  <string>${escapeXml(runtimePath)}</string>
    <key>OZMO_PACKAGE_MANAGER_SCRIPT</key>
    <string>${escapeXml(packageManagerPath)}</string>
	  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`,
  { mode: 0o644 },
);

try {
  execFileSync("/bin/launchctl", ["bootout", serviceDomain], {
    stdio: "ignore",
  });
} catch {
  // First install has no previous service.
}
// launchd can briefly keep the old label reserved after bootout. Retry the
// harmless bootstrap instead of leaving OZMO stopped after a service update.
let bootstrapError;
for (let attempt = 0; attempt < 3; attempt += 1) {
  try {
    execFileSync("/bin/launchctl", [
      "bootstrap",
      userDomain,
      launchAgentPath,
    ]);
    bootstrapError = undefined;
    break;
  } catch (error) {
    bootstrapError = error;
    if (attempt < 2) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
}
if (bootstrapError) throw bootstrapError;
execFileSync("/bin/launchctl", ["enable", serviceDomain]);
execFileSync("/bin/launchctl", ["kickstart", "-k", serviceDomain]);
console.log("OZMO now starts automatically when this Mac user signs in.");
console.log("Secure app: https://192.168.1.196:3000");
console.log("Phone setup: http://192.168.1.196:3001");

function findExecutable(name) {
  return execFileSync("/usr/bin/which", [name], {
    encoding: "utf8",
  }).trim();
}

function findPackageManagerScript() {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "..", "node_modules/pnpm/bin/pnpm.cjs"),
  ].filter(Boolean);
  const script = candidates.find(
    (candidate) =>
      existsSync(candidate) && /\.(?:cjs|mjs|js)$/.test(candidate),
  );
  if (script) return script;

  const executable = findExecutable("pnpm");
  throw new Error(
    `The pnpm program was found at ${executable}, but its startup script could not be located.`,
  );
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
