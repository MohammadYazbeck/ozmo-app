import { authErrorResponse, requireUser } from "@/lib/auth";
import { enqueueNotification } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      endpoint?: unknown;
    };
    const endpoint =
      typeof body.endpoint === "string" && body.endpoint.length <= 2_048
        ? body.endpoint
        : undefined;
    const testId = `push:test:${user.id}:${Date.now()}`;
    const payload = {
      titleEn: "OZMO notifications are ready",
      titleAr: "إشعارات OZMO جاهزة",
      messageEn: "This device can now receive private OZMO reminders.",
      messageAr: "يمكن لهذا الجهاز الآن استقبال تذكيرات OZMO الخاصة.",
      dedupeKey: testId,
      url: "/",
    };

    await enqueueNotification({
      recipientUserIds: [user.id],
      kind: "browser_push_test",
      ...payload,
      suppressPush: true,
    });
    const delivery = await sendPushToUser(user.id, payload, endpoint);

    return Response.json({
      ok: true,
      delivered: delivery.delivered,
      attempted: delivery.attempted,
      expired: delivery.expired,
      failed: delivery.failed,
      warning:
        delivery.delivered === 0
          ? delivery.lastError
            ? `The push provider rejected the test (${delivery.lastError}). Tap Retry test after checking this device.`
            : "The subscription was saved, but no device confirmed the test push."
          : null,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
