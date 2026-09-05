import { authErrorResponse } from "@/lib/auth";
import {
  isEcoAccountingSummary,
  isMonthKey,
} from "@/lib/portal-contract";
import { requirePortalUser } from "@/lib/portal-auth";

export async function GET(request: Request) {
  try {
    const user = await requirePortalUser(request);
    const month = new URL(request.url).searchParams.get("month") ?? "";
    if (!isMonthKey(month)) {
      return Response.json(
        { error: "Invalid month." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const baseUrl = process.env.ECO_API_URL?.trim();
    const token = process.env.ECO_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      return Response.json(
        {
          connected: false,
          client: {
            id: String(user.clientId),
            ozmoClientId: user.ozmoClientId,
            name: user.clientName,
          },
          invoice: null,
          generatedAt: new Date().toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const upstreamUrl = new URL("/api/portal/client-summary", baseUrl);
    upstreamUrl.searchParams.set("month", month);
    const response = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-OZMO-Client-ID": user.ozmoClientId,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !isEcoAccountingSummary(payload)) {
      console.error("eco accounting summary failed", response.status);
      return Response.json(
        { error: "Accounting data is temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (payload.client.ozmoClientId !== user.ozmoClientId) {
      console.error("eco returned a mismatched client identifier");
      return Response.json(
        { error: "Accounting data is temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json(
      {
        connected: true,
        ...payload,
        invoice: {
          ...payload.invoice,
          downloadUrl: `/api/portal/invoice?month=${month}`,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}
