import { AuthError } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

const PORTAL_COOKIE_NAME = "ozmo_portal_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const MAX_LOGIN_ATTEMPTS = 5;

export type PortalUser = {
  id: number;
  clientId: number;
  ozmoClientId: string;
  clientName: string;
  email: string;
  displayName: string;
};

type PortalUserRow = {
  id: number;
  client_id: number;
  ozmo_client_id: string;
  client_name: string;
  email: string;
  display_name: string;
};

export function assertPortalRequest(request: Request) {
  const hostname = requestHostname(request);
  const allowedHosts = new Set(
    (process.env.OZMO_PORTAL_HOSTS ?? "")
      .split(",")
      .map(normalizeHostname)
      .filter(Boolean),
  );
  const local = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname);
  if (!local && !allowedHosts.has(hostname)) {
    throw new AuthError(404, "PORTAL_HOST_NOT_FOUND", "Portal not found.");
  }

  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = normalizeHostname(new URL(origin).hostname);
    } catch {
      throw new AuthError(403, "INVALID_PORTAL_ORIGIN", "Invalid portal origin.");
    }
    if (originHost !== hostname && !local) {
      throw new AuthError(403, "INVALID_PORTAL_ORIGIN", "Invalid portal origin.");
    }
  }
}

export async function getPortalUser(request: Request): Promise<PortalUser | null> {
  assertPortalRequest(request);
  await ensureDatabase();
  const token = readCookie(request, PORTAL_COOKIE_NAME);
  if (!token) return null;

  const database = getD1();
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await database
    .prepare(
      `SELECT
         pu.id,pu.client_id,c.ozmo_client_id,c.name AS client_name,
         pu.email,pu.display_name
       FROM portal_auth_sessions pas
       JOIN portal_users pu ON pu.id=pas.portal_user_id
       JOIN clients c ON c.id=pu.client_id
       WHERE pas.token_hash=? AND pas.expires_at>?
         AND pu.is_active=1 AND c.is_active=1
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<PortalUserRow>();
  if (!row) return null;

  await database
    .prepare(
      "UPDATE portal_auth_sessions SET last_seen_at=? WHERE token_hash=?",
    )
    .bind(now, tokenHash)
    .run();

  return {
    id: Number(row.id),
    clientId: Number(row.client_id),
    ozmoClientId: row.ozmo_client_id,
    clientName: row.client_name,
    email: row.email,
    displayName: row.display_name,
  };
}

export async function requirePortalUser(request: Request): Promise<PortalUser> {
  const user = await getPortalUser(request);
  if (!user) {
    throw new AuthError(401, "PORTAL_AUTH_REQUIRED", "Sign in to continue.");
  }
  return user;
}

export async function createPortalSession(
  portalUserId: number,
  request: Request,
): Promise<string> {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(tokenBytes);
  const tokenHash = await sha256(token);
  const expiresAt = new Date(
    Date.now() + SESSION_LIFETIME_SECONDS * 1_000,
  ).toISOString();
  await getD1()
    .prepare(
      `INSERT INTO portal_auth_sessions
         (token_hash,portal_user_id,expires_at)
       VALUES (?,?,?)`,
    )
    .bind(tokenHash, portalUserId, expiresAt)
    .run();
  return buildPortalCookie(token, request, SESSION_LIFETIME_SECONDS);
}

export async function destroyPortalSession(request: Request) {
  const token = readCookie(request, PORTAL_COOKIE_NAME);
  if (!token) return;
  await ensureDatabase();
  await getD1()
    .prepare("DELETE FROM portal_auth_sessions WHERE token_hash=?")
    .bind(await sha256(token))
    .run();
}

export function clearPortalCookie(request: Request) {
  return buildPortalCookie("", request, 0);
}

export async function assertPortalLoginAllowed(request: Request, email: string) {
  const key = await loginAttemptKey(request, email);
  const row = await getD1()
    .prepare(
      `SELECT attempts,window_started_at,blocked_until
       FROM portal_login_attempts
       WHERE key=?`,
    )
    .bind(key)
    .first<{
      attempts: number;
      window_started_at: string;
      blocked_until: string | null;
    }>();
  if (row?.blocked_until && Date.parse(row.blocked_until) > Date.now()) {
    throw new AuthError(
      429,
      "PORTAL_LOGIN_RATE_LIMITED",
      "Too many sign-in attempts. Try again in 15 minutes.",
    );
  }
}

export async function recordPortalLoginFailure(request: Request, email: string) {
  const database = getD1();
  const key = await loginAttemptKey(request, email);
  const now = new Date();
  const existing = await database
    .prepare(
      `SELECT attempts,window_started_at
       FROM portal_login_attempts
       WHERE key=?`,
    )
    .bind(key)
    .first<{ attempts: number; window_started_at: string }>();
  const withinWindow =
    existing && Date.parse(existing.window_started_at) > now.getTime() - LOGIN_WINDOW_MS;
  const attempts = withinWindow ? Number(existing.attempts) + 1 : 1;
  const windowStartedAt = withinWindow
    ? existing.window_started_at
    : now.toISOString();
  const blockedUntil =
    attempts >= MAX_LOGIN_ATTEMPTS
      ? new Date(now.getTime() + LOGIN_WINDOW_MS).toISOString()
      : null;
  await database
    .prepare(
      `INSERT INTO portal_login_attempts
         (key,attempts,window_started_at,blocked_until,updated_at)
       VALUES (?,?,?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         attempts=excluded.attempts,
         window_started_at=excluded.window_started_at,
         blocked_until=excluded.blocked_until,
         updated_at=CURRENT_TIMESTAMP`,
    )
    .bind(key, attempts, windowStartedAt, blockedUntil)
    .run();
}

export async function clearPortalLoginFailures(request: Request, email: string) {
  await getD1()
    .prepare("DELETE FROM portal_login_attempts WHERE key=?")
    .bind(await loginAttemptKey(request, email))
    .run();
}

function buildPortalCookie(token: string, request: Request, maxAge: number) {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const secure =
    process.env.OZMO_FORCE_SECURE_COOKIES === "1" ||
    forwardedProtocol === "https" ||
    new URL(request.url).protocol === "https:"
      ? "; Secure"
      : "";
  const expires = maxAge === 0 ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
  return `${PORTAL_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${expires}${secure}`;
}

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const cookie of cookies.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return rawValue.join("=") || null;
  }
  return null;
}

async function loginAttemptKey(request: Request, email: string) {
  const address =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return sha256(`${email.trim().toLowerCase()}|${address}`);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toBase64Url(new Uint8Array(bytes));
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function normalizeHostname(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/:\d+$/, "");
}

function requestHostname(request: Request) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const host = forwardedHost || request.headers.get("host");
  return normalizeHostname(host || new URL(request.url).hostname);
}
