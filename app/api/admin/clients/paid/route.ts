import { AuthError, authErrorResponse, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";
import { getClientPayments } from "@/lib/payments";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const clientId = Number(new URL(request.url).searchParams.get("clientId"));
    if (!Number.isSafeInteger(clientId) || clientId < 1) throw new AuthError(400, "INVALID_CLIENT", "Choose a client.");
    return Response.json({ payments: await getClientPayments(clientId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    await ensureDatabase();
    const body = await request.json().catch(() => null);
    const id = Number(body?.clientId);
    const expected = Number(body?.expectedBalanceCents);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(expected) || expected <= 0) {
      throw new AuthError(400, "INVALID_CLIENT_BALANCE", "Choose a client with a valid balance.");
    }
    const database = getD1();
    const paymentId = crypto.randomUUID();
    // Both statements commit together. A stale balance records nothing and clears nothing.
    const [result] = await database.batch([
      database.prepare(`INSERT INTO client_payments
        (id,client_id,amount_cents,currency,recorded_by,recorded_by_name)
        SELECT ?,id,remaining_payment_cents,remaining_payment_currency,?,?
        FROM clients WHERE id=? AND is_active=1 AND remaining_payment_cents=? AND remaining_payment_cents>0`)
        .bind(paymentId, admin.id, admin.displayName, id, expected),
      database.prepare(`UPDATE clients SET remaining_payment_cents=0,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND EXISTS(SELECT 1 FROM client_payments WHERE id=?)`).bind(id, paymentId),
    ]);
    if (!result.meta.changes) throw new AuthError(409, "BALANCE_CHANGED", "This client's balance changed. Refresh the dashboard and try again.");
    return Response.json({ ok: true, remainingPaymentCents: 0 });
  } catch (error) { return authErrorResponse(error); }
}
