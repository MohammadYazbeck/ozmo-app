export function isMonthKey(value: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

export type EcoAccountingSummary = {
  client: {
    id: string;
    ozmoClientId: string;
    name: string;
  };
  invoice: {
    month: string;
    currency: string;
    amountCents: number;
    paidAmountCents: number;
    balanceCents: number;
    amountDueCents: number;
    status: "paid" | "credit" | "partial" | "unpaid";
    dueDate: string;
  };
  generatedAt: string;
};

export function isEcoAccountingSummary(
  value: unknown,
): value is EcoAccountingSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<EcoAccountingSummary>;
  const client = summary.client;
  const invoice = summary.invoice;
  return Boolean(
    client &&
      typeof client.id === "string" &&
      typeof client.ozmoClientId === "string" &&
      typeof client.name === "string" &&
      invoice &&
      isMonthKey(invoice.month) &&
      typeof invoice.currency === "string" &&
      Number.isSafeInteger(invoice.amountCents) &&
      Number.isSafeInteger(invoice.paidAmountCents) &&
      Number.isSafeInteger(invoice.balanceCents) &&
      Number.isSafeInteger(invoice.amountDueCents) &&
      ["paid", "credit", "partial", "unpaid"].includes(invoice.status ?? "") &&
      typeof invoice.dueDate === "string" &&
      typeof summary.generatedAt === "string",
  );
}
