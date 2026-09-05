import { authErrorResponse } from "@/lib/auth";
import {
  assertPortalRequest,
  clearPortalCookie,
  destroyPortalSession,
} from "@/lib/portal-auth";

export async function POST(request: Request) {
  try {
    assertPortalRequest(request);
    await destroyPortalSession(request);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": clearPortalCookie(request),
        },
      },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
