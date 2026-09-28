import { AuthError, authErrorResponse, requireUser } from "@/lib/auth";
import { ensureCalendarItems } from "@/lib/content-calendar";
import { ensureDatabase, getD1 } from "@/lib/db";
import { sendPushToPortalClient } from "@/lib/push";

export const dynamic = "force-dynamic";

function validMonth(value: string) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }

export async function GET(request: Request) {
  try {
    await requireUser(request);
    await ensureDatabase();
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit" }).format(new Date());
    if (!validMonth(month)) throw new AuthError(400, "INVALID_MONTH", "Choose a valid month.");
    const db = getD1();
    const clients = await db.prepare("SELECT id,name,calendar_enabled FROM clients WHERE is_active=1 ORDER BY name").all<{ id: number; name: string; calendar_enabled: number }>();
    for (const client of clients.results) if (client.calendar_enabled) await ensureCalendarItems(client.id, month);
    const rules = await db.prepare("SELECT client_id,weekday,content_type FROM client_calendar_rules ORDER BY client_id,weekday").all<{ client_id: number; weekday: number; content_type: string }>();
    const items = await db.prepare(
      `SELECT i.id,i.client_id,c.name AS client_name,i.scheduled_date,i.content_type,i.status,i.review_url,i.viewed_at,i.published_at
       FROM client_calendar_items i JOIN clients c ON c.id=i.client_id
       WHERE i.scheduled_date>=? AND i.scheduled_date<? AND c.is_active=1 ORDER BY i.scheduled_date,i.id`,
    ).bind(`${month}-01`, nextMonth(month)).all<{ id: number; client_id: number; client_name: string; scheduled_date: string; content_type: string; status: string; review_url: string | null; viewed_at: string | null; published_at: string | null }>();
    return Response.json({ month, clients: clients.results.map((client) => ({ id: String(client.id), name: client.name, enabled: Boolean(client.calendar_enabled) })), rules: rules.results.map((rule) => ({ clientId: String(rule.client_id), weekday: rule.weekday, contentType: rule.content_type })), items: items.results.map((item) => ({ id: String(item.id), clientId: String(item.client_id), clientName: item.client_name, date: item.scheduled_date, contentType: item.content_type, status: item.status, reviewUrl: item.review_url, viewedAt: item.viewed_at, publishedAt: item.published_at })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureDatabase();
    const body = await request.json().catch(() => null) as { action?: unknown; clientId?: unknown; enabled?: unknown; rules?: unknown; itemId?: unknown; reviewUrl?: unknown } | null;
    const db = getD1();
    if (body?.action === "configure") {
      if (user.role !== "admin") throw new AuthError(403, "ADMIN_REQUIRED", "Only administrators can configure client calendars.");
      const clientId = Number(body.clientId);
      if (!Number.isSafeInteger(clientId) || clientId < 1 || !Array.isArray(body.rules)) throw new AuthError(400, "INVALID_CALENDAR", "Choose a client and valid publishing days.");
      const rules = body.rules.slice(0, 14).map((raw) => raw as { weekday?: unknown; contentType?: unknown });
      const normalized = rules.map((rule) => ({ weekday: Number(rule.weekday), contentType: String(rule.contentType) })).filter((rule) => Number.isInteger(rule.weekday) && rule.weekday >= 0 && rule.weekday <= 6 && ["reel", "post"].includes(rule.contentType));
      const statements: D1PreparedStatement[] = [db.prepare("UPDATE clients SET calendar_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_active=1").bind(body.enabled ? 1 : 0, clientId), db.prepare("DELETE FROM client_calendar_rules WHERE client_id=?").bind(clientId)];
      for (const rule of normalized) statements.push(db.prepare("INSERT OR IGNORE INTO client_calendar_rules (client_id,weekday,content_type) VALUES (?,?,?)").bind(clientId, rule.weekday, rule.contentType));
      await db.batch(statements);
      return Response.json({ ok: true });
    }
    if (body?.action === "link") {
      if (!['admin','account_manager'].includes(user.role)) throw new AuthError(403, "MANAGER_REQUIRED", "Only administrators and account managers can add review links.");
      const itemId = Number(body.itemId);
      let reviewUrl: string;
      try { reviewUrl = new URL(String(body.reviewUrl)).toString(); } catch { throw new AuthError(400, "INVALID_URL", "Enter a valid review link."); }
      if (!/^https:\/\//i.test(reviewUrl)) throw new AuthError(400, "INVALID_URL", "The review link must use HTTPS.");
      const item = await db.prepare("SELECT id,client_id,content_type FROM client_calendar_items WHERE id=? AND status IN ('ready','link_added','viewed')").bind(itemId).first<{ id: number; client_id: number; content_type: string }>();
      if (!item) throw new AuthError(404, "ITEM_NOT_FOUND", "Choose ready content from the calendar.");
      await db.batch([
        db.prepare("UPDATE client_calendar_items SET review_url=?,review_added_at=CURRENT_TIMESTAMP,status='link_added',viewed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(reviewUrl, itemId),
        db.prepare("INSERT INTO portal_notifications (client_id,calendar_item_id,title_ar,message_ar) VALUES (?,?,?,?)").bind(item.client_id, itemId, "محتوى جديد بانتظار المراجعة", `راجعوا ${item.content_type === 'reel' ? 'الريل' : 'المنشور'} الأخير في التقويم`),
      ]);
      await sendPushToPortalClient(item.client_id, { titleEn: "New content is ready", titleAr: "محتوى جديد بانتظار المراجعة", messageEn: "Review the latest content in your calendar", messageAr: `راجعوا ${item.content_type === 'reel' ? 'الريل' : 'المنشور'} الأخير في التقويم`, url: "/portal" }).catch((error) => console.error("Portal push failed", error));
      return Response.json({ ok: true });
    }
    throw new AuthError(400, "INVALID_ACTION", "Choose a valid calendar action.");
  } catch (error) { return authErrorResponse(error); }
}

function nextMonth(month: string) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`; }
