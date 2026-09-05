import { authErrorResponse } from "@/lib/auth";
import { getPortalUser } from "@/lib/portal-auth";

export async function GET(request: Request) {
  try {
    const user = await getPortalUser(request);
    return Response.json(
      { user },
      {
        status: user ? 200 : 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
