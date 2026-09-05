import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const hostname = (forwardedHost || request.headers.get("host") || request.nextUrl.hostname)
    .toLowerCase()
    .replace(/:\d+$/, "");
  const portalHosts = new Set(
    (process.env.OZMO_PORTAL_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  if (!portalHosts.has(hostname)) return NextResponse.next();

  const pathname = request.nextUrl.pathname;
  if (pathname === "/") {
    return NextResponse.rewrite(new URL("/portal", request.url));
  }
  if (
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/portal/") &&
    pathname !== "/api/health" &&
    pathname !== "/api/client-logo"
  ) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.svg|manifest.webmanifest).*)"],
};
