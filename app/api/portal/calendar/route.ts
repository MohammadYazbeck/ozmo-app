import { authErrorResponse, AuthError } from "@/lib/auth";
import { ensureCalendarItems } from "@/lib/content-calendar";
import { getD1 } from "@/lib/db";
import { requirePortalUser } from "@/lib/portal-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requirePortalUser(request);
    const month = new URL(request.url).searchParams.get("month") ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Damascus", year: "numeric", month: "2-digit" }).format(new Date());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AuthError(400, "INVALID_MONTH", "Invalid month.");
    await ensureCalendarItems(user.clientId, month);
    const db = getD1();
    const client = await db.prepare("SELECT calendar_enabled FROM clients WHERE id=?").bind(user.clientId).first<{ calendar_enabled: number }>();
    const items = await db.prepare(
      `SELECT id,scheduled_date,content_type,status,review_url,viewed_at,published_at
       FROM client_calendar_items WHERE client_id=? AND scheduled_date>=? AND scheduled_date<? ORDER BY scheduled_date,id`,
    ).bind(user.clientId, `${month}-01`, nextMonth(month)).all<{ id: number; scheduled_date: string; content_type: string; status: string; review_url: string | null; viewed_at: string | null; published_at: string | null }>();
    const notifications = await db.prepare(
      `SELECT id,calendar_item_id,title_ar,message_ar,read_at,created_at FROM portal_notifications
       WHERE client_id=? ORDER BY created_at DESC LIMIT 20`,
    ).bind(user.clientId).all<{ id: number; calendar_item_id: number | null; title_ar: string; message_ar: string; read_at: string | null; created_at: string }>();
    return Response.json({ enabled: Boolean(client?.calendar_enabled), month, items: items.results.map((item) => ({ id: String(item.id), date: item.scheduled_date, contentType: item.content_type, status: item.status, hasReviewLink: Boolean(item.review_url), viewedAt: item.viewed_at, publishedAt: item.published_at })), notifications: notifications.results.map((item) => ({ id: String(item.id), itemId: item.calendar_item_id == null ? null : String(item.calendar_item_id), title: item.title_ar, message: item.message_ar, read: Boolean(item.read_at), createdAt: item.created_at })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requirePortalUser(request); const body = await request.json().catch(() => null) as { notificationId?: unknown } | null; const id = Number(body?.notificationId);
    if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, "INVALID_NOTIFICATION", "Invalid notification.");
    await getD1().prepare("UPDATE portal_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND client_id=?").bind(id, user.clientId).run();
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requirePortalUser(request);
    const body = await request.json().catch(() => null) as { itemId?: unknown } | null;
    const itemId = Number(body?.itemId);
    if (!Number.isSafeInteger(itemId) || itemId < 1) throw new AuthError(400, "INVALID_ITEM", "Invalid calendar item.");
    const db = getD1();
    const item = await db.prepare("SELECT review_url,status FROM client_calendar_items WHERE id=? AND client_id=? AND review_url IS NOT NULL").bind(itemId, user.clientId).first<{ review_url: string; status: string }>();
    if (!item) throw new AuthError(404, "LINK_NOT_FOUND", "Review link not found.");
    await db.batch([
      db.prepare("UPDATE client_calendar_items SET status=CASE WHEN status='published' THEN status ELSE 'viewed' END,viewed_at=COALESCE(viewed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP WHERE id=? AND client_id=?").bind(itemId, user.clientId),
      db.prepare("UPDATE portal_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE calendar_item_id=? AND client_id=?").bind(itemId, user.clientId),
    ]);
    return Response.json({ url: item.review_url });
  } catch (error) { return authErrorResponse(error); }
}

function nextMonth(month: string) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`; }
