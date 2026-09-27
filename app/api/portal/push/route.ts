import { authErrorResponse } from "@/lib/auth";
import { requirePortalUser } from "@/lib/portal-auth";
import { getPortalPushConfiguration, removePortalPushSubscription, savePortalPushSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { const user = await requirePortalUser(request); const endpoint = new URL(request.url).searchParams.get("endpoint"); return Response.json(await getPortalPushConfiguration(user.id, endpoint ?? undefined), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePortalUser(request);
    const body = await request.json() as { subscription?: { endpoint?: unknown; expirationTime?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }; deviceLabel?: unknown; platform?: unknown };
    const subscription = body.subscription;
    if (!subscription || typeof subscription.endpoint !== "string" || typeof subscription.keys?.p256dh !== "string" || typeof subscription.keys.auth !== "string") return Response.json({ error: "اشتراك إشعارات غير صالح" }, { status: 400 });
    await savePortalPushSubscription(user.id, { endpoint: subscription.endpoint, expirationTime: typeof subscription.expirationTime === "number" ? subscription.expirationTime : null, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } }, { deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel : request.headers.get("user-agent") ?? "", platform: typeof body.platform === "string" ? body.platform : "" });
    return Response.json({ ok: true, subscribed: true });
  } catch (error) { return authErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try { const user = await requirePortalUser(request); const body = await request.json() as { endpoint?: unknown }; if (typeof body.endpoint !== "string") return Response.json({ error: "الرابط مطلوب" }, { status: 400 }); await removePortalPushSubscription(user.id, body.endpoint); return Response.json({ ok: true, subscribed: false }); }
  catch (error) { return authErrorResponse(error); }
}
