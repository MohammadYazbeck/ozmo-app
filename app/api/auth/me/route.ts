import {
  AuthError,
  authErrorResponse,
  createAuthSession,
  hashPassword,
  requireUser,
  validatePassword,
  verifyPassword,
} from "@/lib/auth";
import { getD1 } from "@/lib/db";

type MePatchBody = {
  tutorialCompleted?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
};

type PasswordRow = { password_hash: string | null };

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json(
      { user },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as MePatchBody;
    const database = getD1();
    const updates: string[] = [];
    const values: unknown[] = [];
    let sessionCookie: string | null = null;

    if (typeof body.tutorialCompleted === "boolean") {
      updates.push("tutorial_completed = ?");
      values.push(body.tutorialCompleted ? 1 : 0);
    }

    const wantsPasswordChange =
      body.currentPassword !== undefined || body.newPassword !== undefined;
    if (wantsPasswordChange) {
      if (
        typeof body.currentPassword !== "string" ||
        typeof body.newPassword !== "string"
      ) {
        throw new AuthError(
          400,
          "INVALID_PASSWORD_CHANGE",
          "Current and new passwords are required.",
        );
      }

      const current = await database
        .prepare("SELECT password_hash FROM users WHERE id = ? LIMIT 1")
        .bind(user.id)
        .first<PasswordRow>();
      if (
        !current ||
        !(await verifyPassword(body.currentPassword, current.password_hash))
      ) {
        throw new AuthError(
          401,
          "INCORRECT_PASSWORD",
          "The current password is incorrect.",
        );
      }

      const passwordError = validatePassword(body.newPassword);
      if (passwordError) {
        throw new AuthError(400, "WEAK_PASSWORD", passwordError);
      }
      if (body.currentPassword === body.newPassword) {
        throw new AuthError(
          400,
          "PASSWORD_UNCHANGED",
          "Choose a password you have not just used.",
        );
      }

      updates.push("password_hash = ?", "must_change_password = 0");
      values.push(await hashPassword(body.newPassword));
    }

    if (updates.length === 0) {
      throw new AuthError(
        400,
        "NO_CHANGES",
        "No supported changes were provided.",
      );
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    await database
      .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...values, user.id)
      .run();

    if (wantsPasswordChange) {
      await database
        .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
        .bind(user.id)
        .run();
      sessionCookie = await createAuthSession(user.id, request);
    }

    const refreshed = {
      ...user,
      tutorialCompleted:
        typeof body.tutorialCompleted === "boolean"
          ? body.tutorialCompleted
          : user.tutorialCompleted,
      mustChangePassword: wantsPasswordChange
        ? false
        : user.mustChangePassword,
    };

    const headers = new Headers({ "Cache-Control": "no-store" });
    if (sessionCookie) headers.set("Set-Cookie", sessionCookie);
    return Response.json({ user: refreshed }, { headers });
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
