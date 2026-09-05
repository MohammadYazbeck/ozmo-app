import {
  assertOfficeRequest,
  authErrorResponse,
  requireUser,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { damascusDate } from "@/lib/time";
import {
  auditSessionChange,
  notifySessionStatus,
  type SessionRecord,
} from "@/lib/notifications";

export const dynamic = "force-dynamic";

type SessionStatus = "scheduled" | "completed" | "cancelled" | "missed";

type SessionUser = Awaited<ReturnType<typeof requireUser>>;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function handleError(error: unknown) {
  const authResponse = authErrorResponse(error);
  if (authResponse) return authResponse;
  console.error("Session API error", error);
  return jsonError("Unable to process the session.", 500);
}

function canManageSessions(user: SessionUser) {
  return user.role === "admin" || user.role === "account_manager";
}

function cleanNotes(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("INVALID_NOTES");
  const notes = value.trim();
  if (notes.length > 2000) throw new Error("NOTES_TOO_LONG");
  return notes || null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("INVALID_SCHEDULE");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("INVALID_SCHEDULE");
  return date.toISOString();
}

function isSessionStatus(value: unknown): value is SessionStatus {
  return ["scheduled", "completed", "cancelled", "missed"].includes(
    String(value),
  );
}

async function getSession(id: number) {
  const db = getD1();
  return db
    .prepare(
      `SELECT
         s.id,
         s.client_id AS clientId,
         c.name AS clientName,
         s.created_by_user_id AS createdByUserId,
         u.display_name AS createdByName,
         s.scheduled_for AS scheduledFor,
         s.status,
         s.notes,
         s.reels_shot AS reelsShot,
         s.reminder_sent_at AS reminderSentAt,
         s.missed_alert_sent_at AS missedAlertSentAt,
         s.created_at AS createdAt,
         s.updated_at AS updatedAt
       FROM sessions s
       JOIN clients c ON c.id = s.client_id
       JOIN users u ON u.id = s.created_by_user_id
       WHERE s.id = ?
         AND NOT EXISTS (
           SELECT 1 FROM session_deletions d WHERE d.session_id=s.id
         )`,
    )
    .bind(id)
    .first<SessionRecord & { createdByName: string }>();
}

async function requireActiveClient(clientId: number) {
  const db = getD1();
  return db
    .prepare("SELECT id, name FROM clients WHERE id = ? AND is_active = 1")
    .bind(clientId)
    .first<{ id: number; name: string }>();
}

export async function GET(request: Request) {
  try {
    await assertOfficeRequest(request);
    await requireUser(request);
    await ensureDatabase();
    const url = new URL(request.url);
    const rawClientId = url.searchParams.get("clientId");
    const clientId = rawClientId ? Number(rawClientId) : null;
    const status = url.searchParams.get("status");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const rawLimit = Number(url.searchParams.get("limit") ?? 100);
    const limit = Math.min(
      Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1),
      200,
    );
    if (status && !isSessionStatus(status)) {
      return jsonError("Invalid session status.", 400);
    }
    if (
      rawClientId &&
      (!Number.isSafeInteger(clientId) || Number(clientId) <= 0)
    ) {
      return jsonError("Invalid client id.", 400);
    }
    if (from && !Number.isFinite(new Date(from).getTime())) {
      return jsonError("Invalid from date.", 400);
    }
    if (to && !Number.isFinite(new Date(to).getTime())) {
      return jsonError("Invalid to date.", 400);
    }

    const clauses: string[] = [
      "NOT EXISTS (SELECT 1 FROM session_deletions d WHERE d.session_id=s.id)",
    ];
    const bindings: (string | number)[] = [];
    if (clientId) {
      clauses.push("s.client_id = ?");
      bindings.push(clientId);
    }
    if (status) {
      clauses.push("s.status = ?");
      bindings.push(status);
    }
    if (from) {
      clauses.push("s.scheduled_for >= ?");
      bindings.push(new Date(from).toISOString());
    }
    if (to) {
      clauses.push("s.scheduled_for <= ?");
      bindings.push(new Date(to).toISOString());
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const db = getD1();
    const result = await db
      .prepare(
        `SELECT
           s.id,
           s.client_id AS clientId,
           c.name AS clientName,
           s.created_by_user_id AS createdByUserId,
           u.display_name AS createdByName,
           s.scheduled_for AS scheduledFor,
           s.status,
           s.notes,
           s.reels_shot AS reelsShot,
           s.reminder_sent_at AS reminderSentAt,
           s.missed_alert_sent_at AS missedAlertSentAt,
           s.created_at AS createdAt,
           s.updated_at AS updatedAt
         FROM sessions s
         JOIN clients c ON c.id = s.client_id
         JOIN users u ON u.id = s.created_by_user_id
         ${where}
         ORDER BY
           CASE WHEN s.status = 'scheduled' THEN 0 ELSE 1 END,
           s.scheduled_for ASC
         LIMIT ?`,
      )
      .bind(...bindings, limit)
      .all<SessionRecord & { createdByName: string }>();
    return Response.json(
      { sessions: result.results ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    await assertOfficeRequest(request);
    const user = await requireUser(request);
    if (!canManageSessions(user)) {
      return jsonError(
        "Only administrators and account managers can schedule sessions.",
        403,
      );
    }
    await ensureDatabase();
    const body = (await request.json()) as {
      clientId?: unknown;
      scheduledFor?: unknown;
      notes?: unknown;
    };
    const clientId = Number(body.clientId);
    if (!Number.isSafeInteger(clientId) || clientId <= 0) {
      return jsonError("A client is required.", 400);
    }
    const client = await requireActiveClient(clientId);
    if (!client) return jsonError("Client not found.", 404);
    const scheduledFor = normalizeDate(body.scheduledFor);
    const notes = cleanNotes(body.notes);
    const now = new Date().toISOString();
    const db = getD1();
    const inserted = await db
      .prepare(
        `INSERT INTO sessions (
           client_id, created_by_user_id, scheduled_for, status,
           notes, reminder_sent_at, missed_alert_sent_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'scheduled', ?, NULL, NULL, ?, ?)`,
      )
      .bind(client.id, user.id, scheduledFor, notes ?? "", now, now)
      .run();
    const id = Number(inserted.meta.last_row_id);
    await auditSessionChange({
      userId: user.id,
      clientId: client.id,
      action: "schedule",
      status: "scheduled",
      description: `Scheduled for ${scheduledFor}${
        notes ? `. Notes: ${notes}` : ""
      }`,
    });
    return Response.json({ session: await getSession(id) }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON body.", 400);
    }
    if (error instanceof Error && error.message === "INVALID_SCHEDULE") {
      return jsonError("A valid session date and time is required.", 400);
    }
    if (error instanceof Error && error.message === "INVALID_NOTES") {
      return jsonError("Notes must be text.", 400);
    }
    if (error instanceof Error && error.message === "NOTES_TOO_LONG") {
      return jsonError("Notes must be 2,000 characters or fewer.", 400);
    }
    return handleError(error);
  }
}

const allowedTransitions: Record<SessionStatus, SessionStatus[]> = {
  scheduled: ["scheduled", "completed", "cancelled", "missed"],
  completed: ["completed"],
  cancelled: ["cancelled", "scheduled"],
  missed: ["missed", "scheduled"],
};

export async function PUT(request: Request) {
  try {
    await assertOfficeRequest(request);
    const user = await requireUser(request);
    if (!canManageSessions(user)) {
      return jsonError(
        "Only administrators and account managers can update sessions.",
        403,
      );
    }
    await ensureDatabase();
    const body = (await request.json()) as {
      id?: unknown;
      clientId?: unknown;
      scheduledFor?: unknown;
      status?: unknown;
      notes?: unknown;
      reelsShot?: unknown;
    };
    const sessionId = Number(body.id);
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return jsonError("A session id is required.", 400);
    }
    const current = await getSession(sessionId);
    if (!current) return jsonError("Session not found.", 404);
    const currentStatus: SessionStatus = current.status;

    const clientId =
      body.clientId === undefined ? current.clientId : Number(body.clientId);
    if (!Number.isSafeInteger(clientId) || clientId <= 0) {
      return jsonError("Invalid client id.", 400);
    }
    const client = await requireActiveClient(clientId);
    if (!client) return jsonError("Client not found.", 404);
    const scheduledFor =
      body.scheduledFor === undefined
        ? current.scheduledFor
        : normalizeDate(body.scheduledFor);
    const requestedStatus =
      body.status === undefined ? currentStatus : String(body.status);
    if (!isSessionStatus(requestedStatus)) {
      return jsonError("Invalid session status.", 400);
    }
    const status: SessionStatus = requestedStatus;
    if (!allowedTransitions[currentStatus].includes(status)) {
      return jsonError(
        `A ${currentStatus} session cannot be changed to ${status}.`,
        409,
      );
    }
    const notes =
      body.notes === undefined ? current.notes : cleanNotes(body.notes);
    let reelsShot = current.reelsShot;
    if (status === "completed") {
      if (body.reelsShot === undefined && currentStatus !== "completed") {
        return jsonError(
          "Enter how many reels were shot in this session.",
          400,
        );
      }
      if (body.reelsShot !== undefined) {
        reelsShot = Number(body.reelsShot);
        if (
          !Number.isSafeInteger(reelsShot) ||
          reelsShot < 0 ||
          reelsShot > 500
        ) {
          return jsonError(
            "Reels shot must be a whole number from 0 to 500.",
            400,
          );
        }
      }
    } else if (status === "scheduled") {
      reelsShot = null;
    }
    const rescheduled =
      scheduledFor !== current.scheduledFor ||
      clientId !== current.clientId ||
      (currentStatus !== "scheduled" && status === "scheduled");
    const enteredAlertState =
      currentStatus !== status &&
      (status === "cancelled" || status === "missed");
    const nowDate = new Date();
    if (nowDate.toISOString() === current.updatedAt) {
      nowDate.setMilliseconds(nowDate.getMilliseconds() + 1);
    }
    const now = nowDate.toISOString();
    const reminderSentAt = rescheduled ? null : current.reminderSentAt;
    const missedAlertSentAt =
      enteredAlertState ||
      (currentStatus !== "scheduled" && status === "scheduled")
        ? null
        : current.missedAlertSentAt;

    const shotMovements: Array<{ clientId: number; delta: number }> = [];
    if (status === "completed") {
      const nextCount = reelsShot ?? 0;
      const previousCount =
        currentStatus === "completed" ? current.reelsShot ?? 0 : 0;
      if (currentStatus === "completed" && current.clientId !== clientId) {
        if (previousCount !== 0) {
          shotMovements.push({
            clientId: current.clientId,
            delta: -previousCount,
          });
        }
        if (nextCount !== 0) {
          shotMovements.push({ clientId, delta: nextCount });
        }
      } else if (nextCount !== previousCount) {
        shotMovements.push({
          clientId,
          delta: nextCount - previousCount,
        });
      }
    }

    const db = getD1();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE sessions
           SET client_id = ?, scheduled_for = ?, status = ?, notes = ?,
               reels_shot = ?, reminder_sent_at = ?, missed_alert_sent_at = ?,
               updated_at = ?
           WHERE id = ? AND updated_at = ?`,
        )
        .bind(
          clientId,
          scheduledFor,
          status,
          notes ?? "",
          reelsShot,
          reminderSentAt,
          missedAlertSentAt,
          now,
          current.id,
          current.updatedAt,
        ),
    ];
    for (const [movementIndex, movement] of shotMovements.entries()) {
      const eventType =
        `session_shot_reels:${current.id}:${now}:${movementIndex}`;
      statements.push(
        db
          .prepare(
            `UPDATE inventory_balances
             SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP
             WHERE client_id=? AND content_type='shot_reel'
               AND EXISTS (
                 SELECT 1 FROM sessions
                 WHERE id=? AND updated_at=?
               )`,
          )
          .bind(movement.delta, movement.clientId, current.id, now),
        db
          .prepare(
            `INSERT INTO inventory_events
               (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on)
             SELECT ?, 'shot_reel', ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM sessions
               WHERE id=? AND updated_at=?
             )`,
          )
          .bind(
            movement.clientId,
            movement.delta,
            eventType,
            user.id,
            `Session recorded ${reelsShot ?? 0} shot reel(s).`,
            damascusDate(),
            current.id,
            now,
          ),
        db
          .prepare(
            `UPDATE clients SET updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND EXISTS (
               SELECT 1 FROM sessions
               WHERE sessions.id=? AND sessions.updated_at=?
             )`,
          )
          .bind(movement.clientId, current.id, now),
      );
    }

    let results: D1Result[];
    try {
      results = await db.batch(statements);
    } catch (inventoryError) {
      const message = String(inventoryError);
      if (
        message.includes("inventory_balances_nonnegative") ||
        message.includes("CHECK constraint")
      ) {
        return jsonError(
          "Some shot reels from this session have already been edited. Adjust the Shot reels balance before reducing the session count.",
          409,
        );
      }
      throw inventoryError;
    }
    if (Number(results[0]?.meta?.changes ?? 0) === 0) {
      return jsonError(
        "This session changed while you were editing it. Please refresh.",
        409,
      );
    }

    const action =
      status !== currentStatus
        ? status === "completed"
          ? "complete"
          : status === "cancelled"
            ? "cancel"
            : status === "missed"
              ? "miss"
              : "reschedule"
        : rescheduled
          ? "reschedule"
          : "schedule";
    await auditSessionChange({
      userId: user.id,
      clientId,
      action,
      status,
      description: JSON.stringify({
        event: "session_updated",
        previous: {
          clientId: current.clientId,
          scheduledFor: current.scheduledFor,
          status: currentStatus,
          notes: current.notes,
          reelsShot: current.reelsShot,
        },
        current: { clientId, scheduledFor, status, notes, reelsShot },
      }),
    });
    if (enteredAlertState) {
      await notifySessionStatus(current.id);
    }
    return Response.json({ session: await getSession(current.id) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON body.", 400);
    }
    if (error instanceof Error && error.message === "INVALID_SCHEDULE") {
      return jsonError("A valid session date and time is required.", 400);
    }
    if (error instanceof Error && error.message === "INVALID_NOTES") {
      return jsonError("Notes must be text.", 400);
    }
    if (error instanceof Error && error.message === "NOTES_TOO_LONG") {
      return jsonError("Notes must be 2,000 characters or fewer.", 400);
    }
    return handleError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await assertOfficeRequest(request);
    const user = await requireUser(request);
    if (!canManageSessions(user)) {
      return jsonError(
        "Only administrators and account managers can remove sessions.",
        403,
      );
    }
    await ensureDatabase();
    const body = (await request.json()) as {
      id?: unknown;
      reason?: unknown;
    };
    const sessionId = Number(body.id);
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return jsonError("A session id is required.", 400);
    }
    const reason =
      typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length > 500) {
      return jsonError("The optional reason must be 500 characters or fewer.", 400);
    }
    const current = await getSession(sessionId);
    if (!current) return jsonError("Session not found.", 404);

    const db = getD1();
    await db
      .prepare(
        `INSERT INTO session_deletions
           (session_id,deleted_by_user_id,reason)
         VALUES (?,?,?)`,
      )
      .bind(sessionId, user.id, reason)
      .run();
    await auditSessionChange({
      userId: user.id,
      clientId: current.clientId,
      action: "delete",
      status: current.status,
      description: JSON.stringify({
        event: "session_removed",
        reason,
        session: {
          id: current.id,
          clientId: current.clientId,
          scheduledFor: current.scheduledFor,
          status: current.status,
          notes: current.notes,
          reelsShot: current.reelsShot,
        },
      }),
    });
    return Response.json({ ok: true, sessionId: String(sessionId) });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonError("Invalid JSON body.", 400);
    }
    return handleError(error);
  }
}
