import { AuthError, authErrorResponse, verifyPassword } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import {
  assertPortalLoginAllowed,
  assertPortalRequest,
  clearPortalLoginFailures,
  createPortalSession,
  recordPortalLoginFailure,
} from "@/lib/portal-auth";

type LoginRow = {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  client_id: number;
  ozmo_client_id: string;
  client_name: string;
};

export async function POST(request: Request) {
  try {
    assertPortalRequest(request);
    await ensureDatabase();
    const body = (await request.json().catch(() => null)) as {
      email?: unknown;
      password?: unknown;
    } | null;
    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || email.length > 254 || !password || password.length > 256) {
      throw invalidCredentials();
    }

    await assertPortalLoginAllowed(request, email);
    const database = getD1();
    const user = await database
      .prepare(
        `SELECT
           pu.id,pu.email,pu.password_hash,pu.display_name,pu.client_id,
           c.ozmo_client_id,c.name AS client_name
         FROM portal_users pu
         JOIN clients c ON c.id=pu.client_id
         WHERE pu.email=? COLLATE NOCASE
           AND pu.is_active=1 AND c.is_active=1
         LIMIT 1`,
      )
      .bind(email)
      .first<LoginRow>();
    const validPassword = await verifyPassword(password, user?.password_hash);
    if (!user || !validPassword) {
      await recordPortalLoginFailure(request, email);
      throw invalidCredentials();
    }

    await clearPortalLoginFailures(request, email);
    await database
      .prepare(
        `UPDATE portal_users
         SET last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
      )
      .bind(user.id)
      .run();
    const cookie = await createPortalSession(user.id, request);
    return Response.json(
      {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          clientId: user.client_id,
          ozmoClientId: user.ozmo_client_id,
          clientName: user.client_name,
        },
      },
      { headers: { "Cache-Control": "no-store", "Set-Cookie": cookie } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

function invalidCredentials() {
  return new AuthError(
    401,
    "INVALID_PORTAL_CREDENTIALS",
    "Incorrect email or password.",
  );
}
