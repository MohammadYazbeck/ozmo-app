import {
  authErrorResponse,
  assertOfficeRequest,
  clearAuthSessionCookie,
  destroyAuthSession,
} from "@/lib/auth";

export async function POST(request: Request) {
  try {
    assertOfficeRequest(request);
    await destroyAuthSession(request);
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": clearAuthSessionCookie(request),
        },
      },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
