import type { UserRole } from "@/db/schema";
import { ensureDatabase, getD1 } from "@/lib/db";

export const SESSION_COOKIE_NAME = "ozmo_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 210_000;
const PASSWORD_ALGORITHM = "PBKDF2";
const PASSWORD_HASH_FORMAT = "pbkdf2_sha256";

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  phone: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  tutorialCompleted: boolean;
};

type AuthUserRow = {
  id: number;
  username: string;
  display_name: string;
  phone: string;
  role: UserRole;
  is_active: number;
  must_change_password: number;
  tutorial_completed: number;
};

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Rejects public-host requests. OZMO is intentionally reachable only through
 * localhost, a private LAN address, or a `.local` office hostname.
 */
export function assertOfficeRequest(request: Request): void {
  const requestUrl = new URL(request.url);
  if (!isOfficeHostname(requestUrl.hostname)) {
    throw new AuthError(
      403,
      "OFFICE_NETWORK_ONLY",
      "OZMO is available only from the office network.",
    );
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isOfficeHostname(new URL(origin).hostname)) {
        throw new AuthError(
          403,
          "OFFICE_NETWORK_ONLY",
          "OZMO is available only from the office network.",
        );
      }
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(403, "INVALID_ORIGIN", "Invalid request origin.");
    }
  }
}

export async function getCurrentUser(
  request: Request,
): Promise<AuthUser | null> {
  assertOfficeRequest(request);
  await ensureDatabase();

  const token = readSessionToken(request);
  if (!token) return null;

  const database = getD1();
  const tokenHash = await hashSessionToken(token);
  const now = new Date().toISOString();
  const row = await database
    .prepare(
      `SELECT
        u.id,
        u.username,
        u.display_name,
        u.phone,
        u.role,
        u.is_active,
        u.must_change_password,
        u.tutorial_completed
       FROM auth_sessions auth
       JOIN users u ON u.id = auth.user_id
       WHERE auth.token_hash = ?
         AND auth.expires_at > ?
         AND u.is_active = 1
       LIMIT 1`,
    )
    .bind(tokenHash, now)
    .first<AuthUserRow>();

  if (!row) return null;

  await database
    .prepare(
      "UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?",
    )
    .bind(now, tokenHash)
    .run();

  return authUserFromRow(row);
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getCurrentUser(request);
  if (!user) {
    throw new AuthError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  }
  return user;
}

export async function requireAdmin(request: Request): Promise<AuthUser> {
  const user = await requireUser(request);
  if (user.role !== "admin") {
    throw new AuthError(
      403,
      "ADMIN_REQUIRED",
      "Administrator access is required.",
    );
  }
  return user;
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  console.error("OZMO API error", error);
  return Response.json(
    { error: "Something went wrong. Please try again.", code: "SERVER_ERROR" },
    { status: 500 },
  );
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) {
    return "Password must contain at least 10 characters.";
  }
  if (password.length > 128) {
    return "Password must contain no more than 128 characters.";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include a lowercase letter.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include an uppercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include a number.";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return [
    PASSWORD_HASH_FORMAT,
    PASSWORD_ITERATIONS.toString(),
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string | null | undefined,
): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) {
    // Keep unset/invalid-password login attempts computationally comparable to
    // valid-user attempts without exposing whether a username exists.
    await derivePassword(
      password,
      new TextEncoder().encode("OZMO-auth-dummy"),
      PASSWORD_ITERATIONS,
    );
    return false;
  }

  const actual = await derivePassword(
    password,
    parsed.salt,
    parsed.iterations,
  );
  return constantTimeEqual(actual, parsed.expected);
}

export async function createAuthSession(
  userId: number,
  request: Request,
): Promise<string> {
  await ensureDatabase();
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toBase64Url(tokenBytes);
  const tokenHash = await hashSessionToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_LIFETIME_SECONDS * 1_000,
  ).toISOString();

  await getD1()
    .prepare(
      `INSERT INTO auth_sessions (token_hash,user_id,expires_at)
       VALUES (?,?,?)`,
    )
    .bind(tokenHash, userId, expiresAt)
    .run();

  return buildSessionCookie(token, request, SESSION_LIFETIME_SECONDS);
}

export async function destroyAuthSession(request: Request): Promise<void> {
  const token = readSessionToken(request);
  if (!token) return;
  await ensureDatabase();
  await getD1()
    .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
    .bind(await hashSessionToken(token))
    .run();
}

export function clearAuthSessionCookie(request: Request): string {
  return buildSessionCookie("", request, 0);
}

export function authUserFromRow(row: AuthUserRow): AuthUser {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    phone: row.phone,
    role: row.role,
    isActive: Boolean(row.is_active),
    mustChangePassword: Boolean(row.must_change_password),
    tutorialCompleted: Boolean(row.tutorial_completed),
  };
}

function readSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === SESSION_COOKIE_NAME) {
      const value = rawValue.join("=");
      return value || null;
    }
  }
  return null;
}

function buildSessionCookie(
  token: string,
  request: Request,
  maxAge: number,
): string {
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const forceSecure = process.env.OZMO_FORCE_SECURE_COOKIES === "1";
  const secure =
    forceSecure ||
    forwardedProtocol === "https" ||
    new URL(request.url).protocol === "https:"
      ? "; Secure"
      : "";
  const expires =
    maxAge === 0 ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : "";
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${expires}${secure}`;
}

function isOfficeHostname(rawHostname: string): boolean {
  const hostname = rawHostname
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");

  const trustedHosts = new Set(
    (process.env.OZMO_TRUSTED_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (trustedHosts.has(hostname)) return true;

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.endsWith(".local")
  ) {
    return true;
  }

  if (/^10(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (/^192\.168(?:\.\d{1,3}){2}$/.test(hostname)) return true;

  const private172 = hostname.match(/^172\.(\d{1,3})(?:\.\d{1,3}){2}$/);
  if (private172) {
    const secondOctet = Number(private172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return (
    hostname.startsWith("fc") ||
    hostname.startsWith("fd") ||
    hostname.startsWith("fe80:")
  );
}

async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64Url(new Uint8Array(digest));
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    PASSWORD_ALGORITHM,
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: PASSWORD_ALGORITHM,
      hash: "SHA-256",
      salt: salt.slice().buffer,
      iterations,
    },
    material,
    256,
  );
  return new Uint8Array(bits);
}

function parsePasswordHash(value: string | null | undefined): {
  iterations: number;
  salt: Uint8Array;
  expected: Uint8Array;
} | null {
  if (!value) return null;
  const [format, rawIterations, rawSalt, rawExpected] = value.split("$");
  const iterations = Number(rawIterations);
  if (
    format !== PASSWORD_HASH_FORMAT ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    iterations > 1_000_000 ||
    !rawSalt ||
    !rawExpected
  ) {
    return null;
  }

  try {
    const salt = fromBase64Url(rawSalt);
    const expected = fromBase64Url(rawExpected);
    return salt.length >= 16 && expected.length === 32
      ? { iterations, salt, expected }
      : null;
  } catch {
    return null;
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
