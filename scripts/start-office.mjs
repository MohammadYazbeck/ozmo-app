import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { resolveOfficeHttpsProfile } from "./office-https-profile.mjs";

const children = [];
let stopping = false;
const useHttps = process.argv.includes("--https");
const packageManagerScript =
  process.env.OZMO_PACKAGE_MANAGER_SCRIPT || process.env.npm_execpath || "";
const httpsProfile = resolveOfficeHttpsProfile();
const caCertificate = httpsProfile.caCertificate;
const serverCertificate = httpsProfile.serverCertificate;
const serverKey = httpsProfile.serverKey;

function start(command, args, label, extraEnvironment = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      OZMO_SCHEDULER_LABEL: label,
      ...extraEnvironment,
    },
  });
  child.once("error", (error) => {
    if (stopping) return;
    console.error(`${label} could not start: ${error.message}`);
    stopAll(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `${label} stopped unexpectedly (${signal || `exit ${code ?? "unknown"}`}).`,
    );
    stopAll(typeof code === "number" && code !== 0 ? code : 1);
  });
  children.push(child);
}

function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = code;
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

console.log("Starting OZMO for the private office network…");
if (
  useHttps &&
  ![caCertificate, serverCertificate, serverKey].every((path) =>
    existsSync(path),
  )
) {
  console.error(
    "HTTPS certificates are missing. Run `pnpm https:setup` first.",
  );
  process.exit(1);
}

if (useHttps) {
  start(
    process.execPath,
    ["scripts/certificate-bootstrap.mjs"],
    "OZMO device setup service",
  );
  start(
    process.execPath,
    [
      resolve("node_modules/wrangler/bin/wrangler.js"),
      "dev",
      "--config",
      "dist/server/wrangler.json",
      "--local",
      "--ip",
      "0.0.0.0",
      "--port",
      "3000",
      "--persist-to",
      ".wrangler/state",
      "--local-protocol",
      "https",
      "--https-key-path",
      serverKey,
      "--https-cert-path",
      serverCertificate,
      "--log-level",
      "info",
      "--show-interactive-dev-session",
      "false",
    ],
    "OZMO web server",
  );
} else if (packageManagerScript) {
  start(
    process.execPath,
    [packageManagerScript, "run", "start:lan"],
    "OZMO web server",
  );
} else {
  start(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["run", "start:lan"],
    "OZMO web server",
  );
}
start(
  process.execPath,
  ["--env-file-if-exists=.env.local", "scripts/local-scheduler.mjs"],
  "OZMO reminder service",
  useHttps
    ? {
        NODE_EXTRA_CA_CERTS: caCertificate,
        OZMO_BASE_URL:
          process.env.OZMO_BASE_URL || "https://127.0.0.1:3000",
      }
    : {},
);
