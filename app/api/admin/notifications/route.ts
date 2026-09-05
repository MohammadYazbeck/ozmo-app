import {
  AuthError,
  authErrorResponse,
  requireAdmin,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { enqueueNotification } from "@/lib/notifications";
import {
  sendPushToUser,
  type PushDeliveryResult,
} from "@/lib/push";

export const dynamic = "force-dynamic";

type ManualNotificationBody = {
  recipientUserId?: unknown;
  title?: unknown;
  message?: unknown;
  titleAr?: unknown;
  messageAr?: unknown;
};

type RecipientRow = {
  id: number;
  display_name: string;
};

const EMPTY_DELIVERY: PushDeliveryResult = {
  attempted: 0,
  delivered: 0,
  expired: 0,
  failed: 0,
};

export async function POST(request: Request) {
  try {
    const administrator = await requireAdmin(request);
    const body = (await request.json()) as ManualNotificationBody;
    const recipientUserId = parseRecipientId(body.recipientUserId);
    const title = parseText(body.title, "title", 1, 100, false);
    const message = parseText(body.message, "message", 1, 500, true);
    const titleAr =
      body.titleAr === undefined
        ? title
        : parseText(body.titleAr, "Arabic title", 1, 100, false);
    const messageAr =
      body.messageAr === undefined
        ? message
        : parseText(body.messageAr, "Arabic message", 1, 500, true);

    await ensureDatabase();
    const recipient = await getD1()
      .prepare(
        `SELECT id, display_name
         FROM users
         WHERE id = ? AND is_active = 1
         LIMIT 1`,
      )
      .bind(recipientUserId)
      .first<RecipientRow>();
    if (!recipient) {
      throw new AuthError(
        404,
        "RECIPIENT_NOT_FOUND",
        "Choose an active team member.",
      );
    }

    const dedupeKey = `manual:${administrator.id}:${recipient.id}:${crypto.randomUUID()}`;
    const notificationCreated = await enqueueNotification({
      recipientUserIds: [recipient.id],
      kind: "manual_team_message",
      titleEn: title,
      titleAr,
      messageEn: message,
      messageAr,
      dedupeKey,
      suppressPush: true,
    });
    if (notificationCreated !== 1) {
      throw new AuthError(
        409,
        "NOTIFICATION_NOT_CREATED",
        "The notification could not be created. Please try again.",
      );
    }

    let delivery: PushDeliveryResult = { ...EMPTY_DELIVERY };
    let pushDispatchFailed = false;
    try {
      delivery = await sendPushToUser(recipient.id, {
        titleEn: title,
        titleAr,
        messageEn: message,
        messageAr,
        dedupeKey,
        url: "/",
      });
    } catch (error) {
      pushDispatchFailed = true;
      console.error("OZMO manual browser push dispatch failed", {
        recipientUserId: recipient.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return Response.json({
      ok: true,
      notificationCreated: true,
      recipient: {
        id: String(recipient.id),
        displayName: recipient.display_name,
      },
      delivery,
      warning: deliveryWarning(delivery, pushDispatchFailed),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return Response.json(
        {
          error: "Invalid notification request.",
          code: "INVALID_JSON",
        },
        { status: 400 },
      );
    }
    return authErrorResponse(error);
  }
}

function parseRecipientId(value: unknown) {
  const parsed =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new AuthError(
      400,
      "INVALID_RECIPIENT",
      "Choose a valid team member.",
    );
  }
  return parsed;
}

function parseText(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  allowNewlines: boolean,
) {
  if (typeof value !== "string") {
    throw new AuthError(
      400,
      "INVALID_NOTIFICATION",
      `Enter a valid ${label}.`,
    );
  }
  const normalized = allowNewlines
    ? value.replace(/\r\n?/g, "\n").trim()
    : value.replace(/[\r\n]+/g, " ").trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new AuthError(
      400,
      "INVALID_NOTIFICATION",
      `${capitalize(label)} must contain between ${minimum} and ${maximum} characters.`,
    );
  }
  return normalized;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function deliveryWarning(
  delivery: PushDeliveryResult,
  pushDispatchFailed: boolean,
) {
  if (pushDispatchFailed) {
    return "Saved in OZMO, but browser push could not be dispatched. The team member will still see it in the notification centre.";
  }
  if (delivery.attempted === 0) {
    return "Saved in OZMO, but this team member has no active browser notification subscription.";
  }
  if (delivery.delivered === 0) {
    return "Saved in OZMO, but no subscribed device confirmed delivery.";
  }
  if (delivery.failed > 0 || delivery.expired > 0) {
    return "Delivered to at least one device. Some older device subscriptions could not receive it.";
  }
  return null;
}
