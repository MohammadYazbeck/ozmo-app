import { authErrorResponse } from "@/lib/auth";
import { isMonthKey } from "@/lib/portal-contract";
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
        { error: "Accounting is not connected." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const upstreamUrl = new URL("/api/portal/client-invoice", baseUrl);
    upstreamUrl.searchParams.set("month", month);
    const response = await fetch(upstreamUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-OZMO-Client-ID": user.ozmoClientId,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !response.ok ||
      !response.body ||
      !contentType.includes(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
    ) {
      console.error("eco invoice download failed", response.status);
      return Response.json(
        { error: "Invoice download is temporarily unavailable." },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(response.body, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="ozmo-invoice-${month}.xlsx"`,
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
