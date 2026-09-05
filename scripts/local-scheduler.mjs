const baseUrl = process.env.OZMO_BASE_URL || "http://127.0.0.1:3000";
const schedulerKey = process.env.OZMO_SCHEDULER_KEY || "";
const allowPublicUrl = process.env.OZMO_ALLOW_PUBLIC_SCHEDULER_URL === "1";
const intervalMs = 60_000;

const url = new URL("/api/system/tick", baseUrl);

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127
  );
}

function isLocalTarget(target) {
  const hostname = target.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".office") ||
    isPrivateIpv4(hostname) ||
    hostname.startsWith("fc") ||
    hostname.startsWith("fd")
  );
}

if (!allowPublicUrl && !isLocalTarget(url)) {
  throw new Error(
    "OZMO_BASE_URL must point to localhost or a private office address. " +
      "Public scheduler targets are blocked by default.",
  );
}

let stopped = false;
let timer;

async function tick() {
  if (stopped) return;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: schedulerKey
        ? { "x-ozmo-scheduler-key": schedulerKey }
        : undefined,
      signal: AbortSignal.timeout(45_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        `${response.status} ${body.error || response.statusText}`,
      );
    }
    console.log(
      `[${new Date().toISOString()}] OZMO scheduler tick completed`,
      body.counts || {},
    );
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] OZMO scheduler tick failed:`,
      error instanceof Error ? error.message : error,
    );
  } finally {
    if (!stopped) {
      const elapsed = Date.now() - startedAt;
      timer = setTimeout(tick, Math.max(1_000, intervalMs - elapsed));
    }
  }
}

function stop(signal) {
  stopped = true;
  if (timer) clearTimeout(timer);
  console.log(`[${new Date().toISOString()}] Scheduler stopped (${signal}).`);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

console.log(`OZMO scheduler started for ${url.origin}; polling once per minute.`);
void tick();

