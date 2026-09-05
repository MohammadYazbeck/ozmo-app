import { AuthError, authErrorResponse, getCurrentUser } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { getPortalUser } from "@/lib/portal-auth";

type LogoRow = {
  png: Uint8Array;
  updated_at: string;
};

export async function GET(request: Request) {
  try {
    await ensureDatabase();
    const requestedClientId = parseClientId(request);
    const clientId = await authorizedClientId(request, requestedClientId);
    const logo = await getD1()
      .prepare(
        `SELECT l.png,l.updated_at
         FROM client_logos l
         JOIN clients c ON c.id=l.client_id
         WHERE l.client_id=? AND c.is_active=1`,
      )
      .bind(clientId)
      .first<LogoRow>();

    if (!logo) {
      throw new AuthError(404, "LOGO_NOT_FOUND", "Client logo not found.");
    }

    return new Response(Uint8Array.from(logo.png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Last-Modified": new Date(logo.updated_at).toUTCString(),
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

async function authorizedClientId(request: Request, requestedClientId: number) {
  try {
    const staff = await getCurrentUser(request);
    if (staff) return requestedClientId;
  } catch (error) {
    if (!(error instanceof AuthError) || error.code !== "OFFICE_NETWORK_ONLY") {
      throw error;
    }
  }

  const portalUser = await getPortalUser(request);
  if (!portalUser) {
    throw new AuthError(401, "AUTH_REQUIRED", "Sign in to view this logo.");
  }
  if (portalUser.clientId !== requestedClientId) {
    throw new AuthError(403, "CLIENT_SCOPE_REQUIRED", "This logo belongs to another client.");
  }
  return portalUser.clientId;
}

function parseClientId(request: Request) {
  const clientId = Number(new URL(request.url).searchParams.get("clientId"));
  if (!Number.isSafeInteger(clientId) || clientId < 1) {
    throw new AuthError(400, "INVALID_CLIENT", "Choose a valid client.");
  }
  return clientId;
}
