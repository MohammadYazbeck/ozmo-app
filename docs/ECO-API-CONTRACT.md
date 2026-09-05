# eco → OZMO portal API contract

eco remains the source of truth for accounting. OZMO calls eco only from its
server; browsers never receive the integration token or call eco directly.

## Authentication and client identity

Both endpoints require:

```http
Authorization: Bearer <dedicated ECO_API_TOKEN>
X-OZMO-Client-ID: OZMO-0007
```

Reject missing or invalid tokens with `401`. Reject unknown or inactive client
IDs with `404`. Never accept an eco database ID, client name or browser-provided
client ID as the authority. Store `ozmo_client_id` as a unique, immutable field
on the corresponding eco client record.

Use HTTPS. Keep the endpoint read-only, log access without logging the bearer
token, and apply a server-to-server rate limit.

## GET `/api/portal/client-summary?month=YYYY-MM`

Return `200 application/json`:

```json
{
  "client": {
    "id": "eco-client-id",
    "ozmoClientId": "OZMO-0007",
    "name": "BURGASM"
  },
  "invoice": {
    "month": "2026-08",
    "currency": "USD",
    "amountCents": 150000,
    "paidAmountCents": 100000,
    "balanceCents": 50000,
    "amountDueCents": 50000,
    "status": "partial",
    "dueDate": "2026-09-10"
  },
  "generatedAt": "2026-08-22T12:00:00.000Z"
}
```

All money fields are integer minor units (cents), never floating-point amounts.
Allowed status values are `paid`, `credit`, `partial`, and `unpaid`. The returned
`client.ozmoClientId` must exactly match the request header; OZMO rejects a
mismatch.

Return `400` for an invalid month. Use a stable documented rule for which eco
records compose each amount and cover it with tests.

## GET `/api/portal/client-invoice?month=YYYY-MM`

Use the same headers and validation. Return the client's invoice as an XLSX file:

```http
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="invoice-OZMO-0007-2026-08.xlsx"
```

OZMO streams the file through its authenticated portal endpoint. It accepts only
the XLSX content type and does not expose eco's URL or token to the client.

## Error behavior

- `400` invalid `month`.
- `401` missing/invalid bearer token.
- `404` unknown/inactive OZMO client ID or missing invoice.
- `429` rate limited.
- `500` unexpected eco failure with no internal details in the response.

OZMO uses an 8-second timeout for the summary and a 15-second timeout for the
invoice. Any invalid payload, client mismatch or upstream error is presented to
the client as temporarily unavailable.
