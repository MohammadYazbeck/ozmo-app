import {
  assertOfficeRequest,
  authErrorResponse,
  requireUser,
} from "@/lib/auth";
import {
  listNotifications,
  markNotificationsRead,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function handleError(error: unknown) {
  const authResponse = authErrorResponse(error);
  if (authResponse) return authResponse;
  console.error("Notification API error", error);
  return jsonError("Unable to load notifications.", 500);
}

export async function GET(request: Request) {
  try {
    await assertOfficeRequest(request);
    const user = await requireUser(request);
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const rawLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 50;
    return Response.json(
      await listNotifications(user.id, { unreadOnly, limit }),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await assertOfficeRequest(request);
    const user = await requireUser(request);
    const body = (await request.json()) as {
      ids?: unknown;
      all?: unknown;
    };
    const all = body.all === true;
    const ids = Array.isArray(body.ids)
      ? body.ids
          .map((value) => Number(value))
          .filter((value) => Number.isSafeInteger(value) && value > 0)
      : [];
    if (!all && ids.length === 0) {
      return jsonError("Provide notification ids or set all to true.", 400);
    }
    const updated = await markNotificationsRead(user.id, { all, ids });
    return Response.json({ ok: true, updated });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON body.", 400);
    }
    return handleError(error);
  }
}
