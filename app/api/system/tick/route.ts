import {
  assertOfficeRequest,
  authErrorResponse,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { OZMO_TIME_ZONE, runNotificationTick } from "@/lib/notifications";

export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isLoopbackHost(hostname: string) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    hostname.toLowerCase(),
  );
}

function handleError(error: unknown) {
  const authResponse = authErrorResponse(error);
  if (authResponse) return authResponse;
  console.error("OZMO scheduler tick failed", error);
  return Response.json(
    { error: "Notification scheduler tick failed." },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    await assertOfficeRequest(request);
    const url = new URL(request.url);
    const expectedKey = process.env.OZMO_SCHEDULER_KEY?.trim() ?? "";
    const providedKey =
      request.headers.get("x-ozmo-scheduler-key")?.trim() ?? "";

    if (expectedKey) {
      if (!providedKey || !safeEqual(expectedKey, providedKey)) {
        return Response.json(
          { error: "Invalid scheduler key." },
          { status: 401 },
        );
      }
    } else if (!isLoopbackHost(url.hostname)) {
      return Response.json(
        {
          error:
            "OZMO_SCHEDULER_KEY must be configured before LAN scheduler access is allowed.",
        },
        { status: 503 },
      );
    }

    const startedAt = new Date();
    await ensureDatabase();
    const configuredAdmin = await getD1()
      .prepare(
        `SELECT id
         FROM users
         WHERE role = 'admin'
           AND is_active = 1
           AND password_hash IS NOT NULL
         LIMIT 1`,
      )
      .first<{ id: number }>();

    if (!configuredAdmin) {
      return Response.json({
        ok: true,
        skipped: "setup_required",
        timeZone: OZMO_TIME_ZONE,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        counts: {
          reportReminders: 0,
          reportEscalations: 0,
          inventoryAlerts: 0,
          sessionAlerts: 0,
          summaries: 0,
          sessionsMarkedMissed: 0,
        },
      });
    }

    const counts = await runNotificationTick(startedAt);
    return Response.json({
      ok: true,
      timeZone: OZMO_TIME_ZONE,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      counts,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return Response.json(
    { error: "Use POST for scheduler ticks." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
