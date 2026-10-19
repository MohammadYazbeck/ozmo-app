import { AuthError, authErrorResponse, requireAdmin, requireUser } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { enqueueNotification } from "@/lib/notifications";

type TicketStatus = "open" | "in_progress" | "completed";
const STATUSES = new Set<TicketStatus>(["open", "in_progress", "completed"]);

type TicketRow = {
  id: number;
  title: string;
  description: string;
  assignedUserId: number;
  assignedUserName: string;
  clientId: number | null;
  clientName: string | null;
  status: TicketStatus;
  dueAt: string | null;
  assignmentUrl: string | null;
  completionUrl: string | null;
  completionUrlAddedAt: string | null;
  createdByUserId: number;
  createdByName: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type CheckpointRow = {
  id: number;
  ticketId: number;
  label: string;
  sortOrder: number;
  completedAt: string | null;
  completedByUserId: number | null;
};

function text(value: unknown, maximum: number, field: string, required = false) {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    throw new AuthError(400, "INVALID_TICKET", `${field} is invalid.`);
  }
  const normalized = value.trim();
  if (required && !normalized) throw new AuthError(400, "INVALID_TICKET", `${field} is required.`);
  if (normalized.length > maximum) throw new AuthError(400, "INVALID_TICKET", `${field} is too long.`);
  return normalized;
}

function positiveId(value: unknown, field: string) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, "INVALID_TICKET", `${field} is invalid.`);
  return id;
}

function optionalId(value: unknown, field: string) {
  if (value == null || value === "") return null;
  return positiveId(value, field);
}

function optionalDueAt(value: unknown) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AuthError(400, "INVALID_TICKET", "Due date is invalid.");
  }
  return new Date(value).toISOString();
}

function optionalUrl(value: unknown, field: string) {
  if (value == null || value === "") return null;
  const normalized = text(value, 2048, field, true);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new AuthError(400, "INVALID_TICKET_URL", `${field} must be a complete link.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new AuthError(400, "INVALID_TICKET_URL", `${field} must use http or https.`);
  }
  return parsed.toString();
}

async function requireActiveUser(userId: number) {
  const row = await getD1().prepare("SELECT id FROM users WHERE id=? AND is_active=1").bind(userId).first();
  if (!row) throw new AuthError(400, "INVALID_ASSIGNEE", "Choose an active team member.");
}

async function requireActiveClient(clientId: number | null) {
  if (clientId == null) return;
  const row = await getD1().prepare("SELECT id FROM clients WHERE id=? AND is_active=1").bind(clientId).first();
  if (!row) throw new AuthError(400, "INVALID_CLIENT", "Choose an active client.");
}

async function loadTicket(ticketId: number) {
  const row = await getD1().prepare(
    `SELECT id,title,assigned_user_id AS assignedUserId,status,completion_url AS completionUrl
     FROM tickets WHERE id=? AND deleted_at IS NULL`,
  ).bind(ticketId).first<{ id: number; title: string; assignedUserId: number; status: TicketStatus; completionUrl: string | null }>();
  if (!row) throw new AuthError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  return row;
}

async function addEvent(ticketId: number, actorId: number, eventType: string, detail = "") {
  await getD1().prepare(
    "INSERT INTO ticket_events (ticket_id,actor_user_id,event_type,detail) VALUES (?,?,?,?)",
  ).bind(ticketId, actorId, eventType, detail).run();
}

async function notifyAssignment(ticketId: number, title: string, assigneeId: number) {
  await enqueueNotification({
    recipientUserIds: [assigneeId],
    kind: "ticket_assigned",
    titleEn: "New ticket assigned",
    titleAr: "تم تعيين تذكرة جديدة",
    messageEn: `You were assigned: ${title}`,
    messageAr: `تم تعيينك إلى: ${title}`,
    dedupeKey: `ticket:${ticketId}:assigned:${assigneeId}:${Date.now()}`,
  });
}

async function notifyAdminsCompleted(ticketId: number, title: string, actorId: number) {
  const admins = await getD1().prepare(
    "SELECT id FROM users WHERE role='admin' AND is_active=1 AND id<>?",
  ).bind(actorId).all<{ id: number }>();
  const ids = admins.results.map((row) => Number(row.id));
  if (!ids.length) return;
  await enqueueNotification({
    recipientUserIds: ids,
    kind: "ticket_completed",
    titleEn: "Ticket completed",
    titleAr: "تم إكمال التذكرة",
    messageEn: `${title} was marked as completed.`,
    messageAr: `تم تحديد ${title} كمكتملة.`,
    dedupeKey: `ticket:${ticketId}:completed:${Date.now()}`,
  });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureDatabase();
    const db = getD1();
    const access = user.role === "admin" ? "" : "AND t.assigned_user_id=?";
    const statement = db.prepare(
      `SELECT t.id,t.title,t.description,
              t.assigned_user_id AS assignedUserId,assignee.display_name AS assignedUserName,
              t.client_id AS clientId,c.name AS clientName,t.status,t.due_at AS dueAt,
              t.assignment_url AS assignmentUrl,t.completion_url AS completionUrl,
              t.completion_url_added_at AS completionUrlAddedAt,
              t.created_by_user_id AS createdByUserId,creator.display_name AS createdByName,
              t.completed_at AS completedAt,t.created_at AS createdAt,t.updated_at AS updatedAt
       FROM tickets t
       JOIN users assignee ON assignee.id=t.assigned_user_id
       JOIN users creator ON creator.id=t.created_by_user_id
       LEFT JOIN clients c ON c.id=t.client_id
       WHERE t.deleted_at IS NULL ${access}
       ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'open' THEN 1 ELSE 2 END,
                CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,t.due_at,t.updated_at DESC`,
    );
    const result = user.role === "admin"
      ? await statement.all<TicketRow>()
      : await statement.bind(user.id).all<TicketRow>();
    const ids = result.results.map((ticket) => Number(ticket.id));
    let checkpoints: CheckpointRow[] = [];
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(",");
      const checkpointResult = await db.prepare(
        `SELECT id,ticket_id AS ticketId,label,sort_order AS sortOrder,
                completed_at AS completedAt,completed_by_user_id AS completedByUserId
         FROM ticket_checkpoints WHERE ticket_id IN (${placeholders}) ORDER BY sort_order,id`,
      ).bind(...ids).all<CheckpointRow>();
      checkpoints = checkpointResult.results;
    }
    return Response.json({
      tickets: result.results.map((ticket) => ({
        ...ticket,
        id: String(ticket.id),
        assignedUserId: String(ticket.assignedUserId),
        clientId: ticket.clientId == null ? null : String(ticket.clientId),
        checkpoints: checkpoints.filter((checkpoint) => Number(checkpoint.ticketId) === Number(ticket.id)).map((checkpoint) => ({
          ...checkpoint,
          id: String(checkpoint.id),
          ticketId: String(checkpoint.ticketId),
          completed: Boolean(checkpoint.completedAt),
        })),
      })),
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new AuthError(400, "INVALID_TICKET", "Invalid ticket request.");
    const title = text(body.title, 140, "Ticket name", true);
    const description = text(body.description, 4000, "Description");
    const assignedUserId = positiveId(body.assignedUserId, "Assigned member");
    const clientId = optionalId(body.clientId, "Client");
    const dueAt = optionalDueAt(body.dueAt);
    const assignmentUrl = optionalUrl(body.assignmentUrl, "Assignment link");
    const checkpointLabels = Array.isArray(body.checkpoints)
      ? body.checkpoints.map((value) => text(value, 240, "Checkpoint")).filter(Boolean).slice(0, 50)
      : [];
    await Promise.all([requireActiveUser(assignedUserId), requireActiveClient(clientId)]);
    const result = await getD1().prepare(
      `INSERT INTO tickets (title,description,assigned_user_id,client_id,due_at,assignment_url,created_by_user_id)
       VALUES (?,?,?,?,?,?,?)`,
    ).bind(title, description, assignedUserId, clientId, dueAt, assignmentUrl, admin.id).run();
    const ticketId = Number(result.meta.last_row_id);
    for (const [index, label] of checkpointLabels.entries()) {
      await getD1().prepare(
        "INSERT INTO ticket_checkpoints (ticket_id,label,sort_order) VALUES (?,?,?)",
      ).bind(ticketId, label, index).run();
    }
    await addEvent(ticketId, admin.id, "created");
    await notifyAssignment(ticketId, title, assignedUserId);
    return Response.json({ ok: true, ticketId: String(ticketId) }, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureDatabase();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) throw new AuthError(400, "INVALID_TICKET", "Invalid ticket request.");
    const ticketId = positiveId(body.ticketId, "Ticket");
    const action = text(body.action, 40, "Action", true);
    const ticket = await loadTicket(ticketId);
    const isAdmin = user.role === "admin";
    const isAssignee = Number(ticket.assignedUserId) === user.id;
    if (!isAdmin && !isAssignee) throw new AuthError(403, "TICKET_ACCESS_DENIED", "You cannot update this ticket.");
    const db = getD1();

    if (action === "status") {
      const status = body.status as TicketStatus;
      if (!STATUSES.has(status)) throw new AuthError(400, "INVALID_STATUS", "Choose a valid status.");
      await db.prepare(
        `UPDATE tickets SET status=?,completed_at=CASE WHEN ?='completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(status, status, ticketId).run();
      await addEvent(ticketId, user.id, "status_changed", `${ticket.status}->${status}`);
      if (status === "completed" && ticket.status !== "completed") {
        await notifyAdminsCompleted(ticketId, ticket.title, user.id);
      }
      if (ticket.status === "completed" && status !== "completed" && Number(ticket.assignedUserId) !== user.id) {
        await enqueueNotification({
          recipientUserIds: [Number(ticket.assignedUserId)],
          kind: "ticket_updated",
          titleEn: "Ticket reopened",
          titleAr: "تمت إعادة فتح التذكرة",
          messageEn: `${ticket.title} was reopened and is active again.`,
          messageAr: `تمت إعادة فتح ${ticket.title} وأصبحت نشطة من جديد.`,
          dedupeKey: `ticket:${ticketId}:reopened:${Date.now()}`,
        });
      }
      return Response.json({ ok: true });
    }

    if (action === "toggle_checkpoint") {
      const checkpointId = positiveId(body.checkpointId, "Checkpoint");
      const checkpoint = await db.prepare(
        "SELECT id,completed_at FROM ticket_checkpoints WHERE id=? AND ticket_id=?",
      ).bind(checkpointId, ticketId).first<{ id: number; completed_at: string | null }>();
      if (!checkpoint) throw new AuthError(404, "CHECKPOINT_NOT_FOUND", "Checkpoint not found.");
      const completed = Boolean(body.completed);
      await db.prepare(
        `UPDATE ticket_checkpoints SET completed_at=?,completed_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(completed ? new Date().toISOString() : null, completed ? user.id : null, checkpointId).run();
      await db.prepare("UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId).run();
      await addEvent(ticketId, user.id, completed ? "checkpoint_completed" : "checkpoint_reopened", String(checkpointId));
      if (completed) {
        const progress = await db.prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) AS remaining
           FROM ticket_checkpoints WHERE ticket_id=?`,
        ).bind(ticketId).first<{ total: number; remaining: number }>();
        if (Number(progress?.total ?? 0) > 0 && Number(progress?.remaining ?? 0) === 0) {
          const admins = await db.prepare(
            "SELECT id FROM users WHERE role='admin' AND is_active=1 AND id<>?",
          ).bind(user.id).all<{ id: number }>();
          const adminIds = admins.results.map((row) => Number(row.id));
          if (adminIds.length) await enqueueNotification({
            recipientUserIds: adminIds,
            kind: "ticket_updated",
            titleEn: "All checkpoints completed",
            titleAr: "اكتملت جميع نقاط التحقق",
            messageEn: `All checkpoints in ${ticket.title} are now checked. The ticket status remains manual.`,
            messageAr: `اكتملت جميع نقاط التحقق في ${ticket.title}. تبقى حالة التذكرة يدوية.`,
            dedupeKey: `ticket:${ticketId}:checkpoints-complete:${Date.now()}`,
          });
        }
      }
      return Response.json({ ok: true });
    }

    if (action === "add_completion_link") {
      if (!isAssignee) {
        throw new AuthError(403, "ASSIGNEE_REQUIRED", "Only the assigned team member can add the completion link.");
      }
      if (ticket.status !== "completed") {
        throw new AuthError(409, "TICKET_NOT_COMPLETED", "Mark the ticket as completed before adding the completion link.");
      }
      const completionUrl = optionalUrl(body.completionUrl, "Completion link");
      if (!completionUrl) throw new AuthError(400, "COMPLETION_LINK_REQUIRED", "Enter a completion link.");
      await db.prepare(
        `UPDATE tickets SET completion_url=?,completion_url_added_at=COALESCE(completion_url_added_at,CURRENT_TIMESTAMP),
         completion_url_added_by_user_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(completionUrl, user.id, ticketId).run();
      await addEvent(ticketId, user.id, ticket.completionUrl ? "completion_link_updated" : "completion_link_added", completionUrl);
      const admins = await db.prepare(
        "SELECT id FROM users WHERE role='admin' AND is_active=1 AND id<>?",
      ).bind(user.id).all<{ id: number }>();
      const adminIds = admins.results.map((row) => Number(row.id));
      if (adminIds.length) await enqueueNotification({
        recipientUserIds: adminIds,
        kind: "ticket_updated",
        titleEn: ticket.completionUrl ? "Completion link updated" : "Completion link submitted",
        titleAr: ticket.completionUrl ? "تم تحديث رابط الإنجاز" : "تم إرسال رابط الإنجاز",
        messageEn: `The completion link for ${ticket.title} was ${ticket.completionUrl ? "updated" : "submitted"}.`,
        messageAr: `تم ${ticket.completionUrl ? "تحديث" : "إرسال"} رابط الإنجاز لـ ${ticket.title}.`,
        dedupeKey: `ticket:${ticketId}:completion-link:${Date.now()}`,
      });
      return Response.json({ ok: true });
    }

    if (!isAdmin) throw new AuthError(403, "ADMIN_REQUIRED", "Administrator access is required.");

    if (action === "update") {
      const title = text(body.title, 140, "Ticket name", true);
      const description = text(body.description, 4000, "Description");
      const assignedUserId = positiveId(body.assignedUserId, "Assigned member");
      const clientId = optionalId(body.clientId, "Client");
      const dueAt = optionalDueAt(body.dueAt);
      await Promise.all([requireActiveUser(assignedUserId), requireActiveClient(clientId)]);
      await db.prepare(
        `UPDATE tickets SET title=?,description=?,assigned_user_id=?,client_id=?,due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(title, description, assignedUserId, clientId, dueAt, ticketId).run();
      await addEvent(ticketId, user.id, "updated");
      if (assignedUserId !== Number(ticket.assignedUserId)) await notifyAssignment(ticketId, title, assignedUserId);
      return Response.json({ ok: true });
    }

    if (action === "add_checkpoint") {
      const label = text(body.label, 240, "Checkpoint", true);
      const order = await db.prepare(
        "SELECT COALESCE(MAX(sort_order),-1)+1 AS nextOrder FROM ticket_checkpoints WHERE ticket_id=?",
      ).bind(ticketId).first<{ nextOrder: number }>();
      await db.prepare(
        "INSERT INTO ticket_checkpoints (ticket_id,label,sort_order) VALUES (?,?,?)",
      ).bind(ticketId, label, Number(order?.nextOrder ?? 0)).run();
      await db.prepare("UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId).run();
      await addEvent(ticketId, user.id, "checkpoint_added", label);
      await enqueueNotification({
        recipientUserIds: [Number(ticket.assignedUserId)],
        kind: "ticket_updated",
        titleEn: "Ticket updated",
        titleAr: "تم تحديث التذكرة",
        messageEn: `A checkpoint was added to ${ticket.title}.`,
        messageAr: `تمت إضافة نقطة تحقق إلى ${ticket.title}.`,
        dedupeKey: `ticket:${ticketId}:checkpoint:${Date.now()}`,
      });
      return Response.json({ ok: true });
    }

    if (action === "delete_checkpoint") {
      const checkpointId = positiveId(body.checkpointId, "Checkpoint");
      await db.prepare("DELETE FROM ticket_checkpoints WHERE id=? AND ticket_id=?").bind(checkpointId, ticketId).run();
      await db.prepare("UPDATE tickets SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(ticketId).run();
      await addEvent(ticketId, user.id, "checkpoint_deleted", String(checkpointId));
      return Response.json({ ok: true });
    }

    throw new AuthError(400, "INVALID_ACTION", "Unsupported ticket action.");
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const body = await request.json().catch(() => null) as { ticketId?: unknown } | null;
    const ticketId = positiveId(body?.ticketId, "Ticket");
    await loadTicket(ticketId);
    await getD1().prepare(
      "UPDATE tickets SET deleted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(ticketId).run();
    await addEvent(ticketId, admin.id, "deleted");
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
