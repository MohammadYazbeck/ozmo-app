import { AuthError, authErrorResponse, requireAdmin } from "@/lib/auth";
import { ensureDatabase, getD1 } from "@/lib/db";

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    await ensureDatabase();
    const body = await request.json().catch(() => null);
    const id = Number(body?.clientId);
    const expected = Number(body?.expectedBalanceCents);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(expected) || expected < 0) {
      throw new AuthError(400, "INVALID_CLIENT_BALANCE", "Choose a client with a valid balance.");
    }
    const result = await getD1().prepare(`UPDATE clients SET remaining_payment_cents=0,updated_at=CURRENT_TIMESTAMP WHERE id=? AND is_active=1 AND remaining_payment_cents=?`).bind(id, expected).run();
    if (!result.meta.changes) throw new AuthError(409, "BALANCE_CHANGED", "This client's balance changed. Refresh the dashboard and try again.");
    return Response.json({ ok: true, remainingPaymentCents: 0 });
  } catch (error) { return authErrorResponse(error); }
}
