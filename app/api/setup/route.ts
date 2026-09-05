import {
  AuthError,
  authErrorResponse,
  assertOfficeRequest,
  createAuthSession,
  hashPassword,
  validatePassword,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

type SetupBody = {
  username?: unknown;
  password?: unknown;
};

type AdminRow = {
  id: number;
  username: string;
  display_name: string;
  phone: string;
  role: "admin";
  is_active: number;
  must_change_password: number;
  tutorial_completed: number;
};

export async function POST(request: Request) {
  try {
    assertOfficeRequest(request);
    await ensureDatabase();

    const body = (await request.json()) as SetupBody;
    const username =
      typeof body.username === "string"
        ? body.username.trim().toLowerCase()
        : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!username || !password) {
      throw new AuthError(
        400,
        "INVALID_SETUP",
        "Administrator username and password are required.",
      );
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new AuthError(400, "WEAK_PASSWORD", passwordError);
    }

    const database = getD1();
    const admin = await database
      .prepare(
        `SELECT
          id,username,display_name,phone,role,is_active,
          must_change_password,tutorial_completed
         FROM users
         WHERE username = ? AND role = 'admin'
         LIMIT 1`,
      )
      .bind(username)
      .first<AdminRow>();
    if (!admin) {
      throw new AuthError(
        400,
        "INVALID_ADMIN",
        "Choose one of the registered OZMO administrators.",
      );
    }

    const passwordHash = await hashPassword(password);
    const update = await database
      .prepare(
        `UPDATE users
         SET password_hash = ?,
             is_active = 1,
             must_change_password = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND NOT EXISTS (
             SELECT 1
             FROM users
             WHERE role = 'admin'
               AND is_active = 1
               AND password_hash IS NOT NULL
           )`,
      )
      .bind(passwordHash, admin.id)
      .run();

    if (Number(update.meta.changes ?? 0) !== 1) {
      throw new AuthError(
        409,
        "SETUP_COMPLETE",
        "OZMO setup has already been completed. Please sign in.",
      );
    }

    const sessionCookie = await createAuthSession(admin.id, request);
    return Response.json(
      {
        user: {
          id: Number(admin.id),
          username: admin.username,
          displayName: admin.display_name,
          phone: admin.phone,
          role: admin.role,
          isActive: true,
          mustChangePassword: false,
          tutorialCompleted: Boolean(admin.tutorial_completed),
        },
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": sessionCookie,
        },
      },
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Invalid JSON request.", code: "INVALID_JSON" },
        { status: 400 },
      );
    }
    return authErrorResponse(error);
  }
}
