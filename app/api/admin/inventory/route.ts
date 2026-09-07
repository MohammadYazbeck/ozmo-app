import {
  AuthError,
  authErrorResponse,
  requireAdmin,
} from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { damascusDate } from "@/lib/time";

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const database = getD1();
    const body = (await request.json().catch(() => null)) as {
      clientId?: string | number;
      type?: string;
      delta?: number;
      reason?: string;
    } | null;
    const clientId = Number(body?.clientId);
    const type = String(body?.type ?? "");
    const delta = Number(body?.delta);
    const reason = String(body?.reason ?? "").trim();

    if (!Number.isSafeInteger(clientId) || clientId < 1) {
      throw new AuthError(400, "INVALID_CLIENT", "Choose a valid client.");
    }
    if (!["draft", "shot_reel", "reel", "post", "story"].includes(type)) {
      throw new AuthError(
        400,
        "INVALID_CONTENT_TYPE",
        "Choose Draft, Shot reel, Reel, Post or Story.",
      );
    }
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 10_000) {
      throw new AuthError(
        400,
        "INVALID_DELTA",
        "The adjustment must be a non-zero whole number.",
      );
    }
    if (reason.length > 500) {
      throw new AuthError(
        400,
        "INVALID_REASON",
        "The optional reason must be 500 characters or fewer.",
      );
    }
    const client = await database
      .prepare("SELECT id,name FROM clients WHERE id=? AND is_active=1")
      .bind(clientId)
      .first<{ id: number; name: string }>();
    if (!client) {
      throw new AuthError(404, "CLIENT_NOT_FOUND", "That client was not found.");
    }

    try {
      await database.batch([
        database
          .prepare(
            `UPDATE inventory_balances
             SET quantity=quantity+?,updated_at=CURRENT_TIMESTAMP
             WHERE client_id=? AND content_type=?`,
          )
          .bind(delta, clientId, type),
        database
          .prepare(
            `INSERT INTO inventory_events
               (client_id,content_type,delta,event_type,actor_user_id,note,occurred_on)
             VALUES (?,?,?,'manual_adjustment',?,?,?)`,
          )
          .bind(clientId, type, delta, admin.id, reason, damascusDate()),
        database
          .prepare("UPDATE clients SET updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(clientId),
      ]);
    } catch (error) {
      if (
        String(error).includes("CHECK constraint") ||
        String(error).includes("inventory_balances_nonnegative")
      ) {
        throw new AuthError(
          409,
          "NEGATIVE_INVENTORY",
          `${client.name} does not have enough ${type} inventory for that adjustment.`,
        );
      }
      throw error;
    }

    const balance = await database
      .prepare(
        `SELECT quantity FROM inventory_balances
         WHERE client_id=? AND content_type=?`,
      )
      .bind(clientId, type)
      .first<{ quantity: number }>();

    return Response.json({
      ok: true,
      clientId: String(clientId),
      type,
      balance: balance?.quantity ?? 0,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
