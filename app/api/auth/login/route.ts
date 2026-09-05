import {
  AuthError,
  authErrorResponse,
  assertOfficeRequest,
  createAuthSession,
  verifyPassword,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

type LoginRow = {
  id: number;
  username: string;
  display_name: string;
  phone: string;
  role: "admin" | "editor" | "designer" | "account_manager";
  password_hash: string | null;
  is_active: number;
  must_change_password: number;
  tutorial_completed: number;
};

export async function POST(request: Request) {
  try {
    assertOfficeRequest(request);
    await ensureDatabase();

    const body = (await request.json()) as LoginBody;
    const suppliedUsername =
      typeof body.username === "string"
        ? body.username.trim().toLowerCase()
        : "";
    // Keep the roster's canonical spelling while accepting the spelling used
    // once in the supplied phone list.
    const username = suppliedUsername === "zied" ? "zeid" : suppliedUsername;
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password || username.length > 40 || password.length > 256) {
      throw invalidCredentials();
    }

    const database = getD1();
    const row = await database
      .prepare(
        `SELECT
          id,username,display_name,phone,role,password_hash,is_active,
          must_change_password,tutorial_completed
         FROM users
         WHERE username = ?
         LIMIT 1`,
      )
      .bind(username)
      .first<LoginRow>();

    const validPassword = await verifyPassword(password, row?.password_hash);
    if (!row || !row.is_active || !validPassword) {
      throw invalidCredentials();
    }

    await database
      .prepare(
        `UPDATE users
         SET last_login_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(row.id)
      .run();

    const sessionCookie = await createAuthSession(row.id, request);
    return Response.json(
      {
        user: {
          id: Number(row.id),
          username: row.username,
          displayName: row.display_name,
          phone: row.phone,
          role: row.role,
          isActive: Boolean(row.is_active),
          mustChangePassword: Boolean(row.must_change_password),
          tutorialCompleted: Boolean(row.tutorial_completed),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookie,
        },
      },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return authErrorResponse(invalidCredentials());
    }
    return authErrorResponse(error);
  }
}

function invalidCredentials() {
  return new AuthError(
    401,
    "INVALID_CREDENTIALS",
    "Incorrect username or password.",
  );
}
