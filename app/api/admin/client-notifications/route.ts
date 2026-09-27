import { AuthError, authErrorResponse, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { sendPushToPortalClient } from "@/lib/push";

export async function POST(request: Request) {
  try {
    await requireAdmin(request); await ensureDatabase();
    const body = await request.json().catch(() => null) as { clientId?: unknown; title?: unknown; message?: unknown } | null;
    const clientId = Number(body?.clientId); const title = String(body?.title ?? "").trim(); const message = String(body?.message ?? "").trim();
    if (!Number.isSafeInteger(clientId) || clientId < 1 || title.length < 2 || title.length > 100 || message.length < 2 || message.length > 500) throw new AuthError(400, "INVALID_NOTIFICATION", "Enter a client, Arabic title, and message.");
    const client = await getD1().prepare("SELECT id FROM clients WHERE id=? AND is_active=1").bind(clientId).first<{ id: number }>();
    if (!client) throw new AuthError(404, "CLIENT_NOT_FOUND", "Client not found.");
    const inserted = await getD1().prepare("INSERT INTO portal_notifications (client_id,calendar_item_id,title_ar,message_ar) VALUES (?,NULL,?,?)").bind(clientId, title, message).run();
    const delivery = await sendPushToPortalClient(clientId, { id: String(inserted.meta.last_row_id), titleEn: title, titleAr: title, messageEn: message, messageAr: message, url: "/portal" });
    return Response.json({ ok: true, notificationId: String(inserted.meta.last_row_id), delivery });
  } catch (error) { return authErrorResponse(error); }
}
