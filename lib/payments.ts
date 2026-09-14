import { getD1 } from "@/lib/db";

export async function getClientPayments(clientId: number) {
  const result = await getD1().prepare(
    `SELECT id,amount_cents AS amountCents,currency,
      recorded_by_name AS recordedBy,paid_at AS paidAt
     FROM client_payments WHERE client_id=? ORDER BY paid_at DESC,rowid DESC`,
  ).bind(clientId).all<{ id: string; amountCents: number; currency: string; recordedBy: string; paidAt: string }>();
  return result.results;
}
