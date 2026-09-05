import {
  authErrorResponse,
  requireUser,
} from "@/lib/auth";
import {
  getBrowserPushConfiguration,
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push";

type SubscriptionBody = {
  subscription?: {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
  deviceLabel?: unknown;
  platform?: unknown;
  endpoint?: unknown;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const endpoint = new URL(request.url).searchParams.get("endpoint");
    return Response.json(await getBrowserPushConfiguration(
      user.id,
      endpoint ?? undefined,
    ), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as SubscriptionBody;
    const subscription = body.subscription;
    if (
      !subscription ||
      typeof subscription.endpoint !== "string" ||
      typeof subscription.keys?.p256dh !== "string" ||
      typeof subscription.keys.auth !== "string"
    ) {
      return Response.json(
        { error: "A valid browser push subscription is required." },
        { status: 400 },
      );
    }

    const expirationTime =
      typeof subscription.expirationTime === "number"
        ? subscription.expirationTime
        : null;
    await savePushSubscription(
      user.id,
      {
        endpoint: subscription.endpoint,
        expirationTime,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
      },
      {
        deviceLabel:
          typeof body.deviceLabel === "string"
            ? body.deviceLabel
            : request.headers.get("user-agent") ?? "",
        platform: typeof body.platform === "string" ? body.platform : "",
      },
    );

    return Response.json({ ok: true, subscribed: true });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        { error: "Invalid subscription request." },
        { status: 400 },
      );
    }
    if (
      error instanceof Error &&
      (error.message.startsWith("Invalid browser push") ||
        error.message.startsWith("Browser push endpoint"))
    ) {
      return Response.json(
        {
          error: error.message,
          code: error.message.startsWith("Browser push endpoint")
            ? "PUSH_ENDPOINT_UNSUPPORTED"
            : "PUSH_SUBSCRIPTION_INVALID",
        },
        { status: 400 },
      );
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    const body = (await request.json()) as SubscriptionBody;
    if (typeof body.endpoint !== "string" || !body.endpoint) {
      return Response.json(
        { error: "Subscription endpoint is required." },
        { status: 400 },
      );
    }

    await removePushSubscription(user.id, body.endpoint);
    return Response.json({ ok: true, subscribed: false });
  } catch (error) {
    return authErrorResponse(error);
  }
}
