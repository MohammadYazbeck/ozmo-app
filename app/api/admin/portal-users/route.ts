import {
  AuthError,
  authErrorResponse,
  hashPassword,
  requireAdmin,
  validatePassword,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      clientId?: unknown;
      email?: unknown;
      displayName?: unknown;
      password?: unknown;
    } | null;
    const clientId = Number(body?.clientId);
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName =
      typeof body?.displayName === "string" ? body.displayName.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!Number.isSafeInteger(clientId) || clientId < 1) {
      throw new AuthError(400, "INVALID_PORTAL_CLIENT", "Choose a client.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      throw new AuthError(400, "INVALID_PORTAL_EMAIL", "Enter a valid email.");
    }
    if (displayName.length < 2 || displayName.length > 80) {
      throw new AuthError(
        400,
        "INVALID_PORTAL_NAME",
        "Display name must contain 2–80 characters.",
      );
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      throw new AuthError(400, "INVALID_PORTAL_PASSWORD", passwordError);
    }

    const database = getD1();
    const client = await database
      .prepare(
        `SELECT id,ozmo_client_id,name
         FROM clients
         WHERE id=? AND is_active=1
         LIMIT 1`,
      )
      .bind(clientId)
      .first<{ id: number; ozmo_client_id: string; name: string }>();
    if (!client) {
      throw new AuthError(404, "PORTAL_CLIENT_NOT_FOUND", "Client not found.");
    }
    const existing = await database
      .prepare("SELECT id,client_id FROM portal_users WHERE email=? COLLATE NOCASE")
      .bind(email)
      .first<{ id: number; client_id: number }>();
    if (existing && Number(existing.client_id) !== clientId) {
      throw new AuthError(
        409,
        "PORTAL_EMAIL_IN_USE",
        "That email belongs to another client.",
      );
    }
    const passwordHash = await hashPassword(password);
    if (existing) {
      await database
        .prepare(
          `UPDATE portal_users
           SET display_name=?,password_hash=?,is_active=1,
               updated_at=CURRENT_TIMESTAMP
           WHERE id=?`,
        )
        .bind(displayName, passwordHash, existing.id)
        .run();
      await database
        .prepare("DELETE FROM portal_auth_sessions WHERE portal_user_id=?")
        .bind(existing.id)
        .run();
    } else {
      await database
        .prepare(
          `INSERT INTO portal_users
             (client_id,email,display_name,password_hash)
           VALUES (?,?,?,?)`,
        )
        .bind(clientId, email, displayName, passwordHash)
        .run();
    }

    return Response.json(
      {
        user: {
          email,
          displayName,
          clientId,
          ozmoClientId: client.ozmo_client_id,
          clientName: client.name,
        },
        updated: Boolean(existing),
      },
      { status: existing ? 200 : 201 },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
