import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { canonicalUrl } from "@/lib/canonical-url";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export async function middleware(request: NextRequest) {
  // Plain http through Cloudflare, or the www host, goes to the site's https address first (lib/canonical-url.ts).
  const moved = canonicalUrl({ host: request.headers.get("x-forwarded-host") ?? request.headers.get("host"), path: request.nextUrl.pathname, search: request.nextUrl.search, cfVisitor: request.headers.get("cf-visitor") }, process.env.NEXT_PUBLIC_APP_URL);
  if (moved) return NextResponse.redirect(moved, 308);

  // The public site needs no account; everything signed-in lives under /admin.
  const path = request.nextUrl.pathname;
  if (path !== "/admin" && !path.startsWith("/admin/")) return NextResponse.next();

  // Coarse gate only, as in UPB Capital: is there a valid session cookie at all. Roles, permissions and idle timeouts
  // are checked on the server against the database (lib/auth.ts and each workspace's layout).
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// The signed-in panel, as before. Elsewhere middleware runs only for the visits it redirects: plain http through
// Cloudflare, or a www. host. Next copies a request's body for middleware and cuts the copy off at
// middlewareClientMaxBodySize (next.config.mjs), so ordinary https traffic, uploads included, never passes through it.
// Next reads this object at build time, so it stays a literal.
export const config = {
  matcher: [
    "/admin/:path*",
    {
      source: "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png).*)",
      has: [{ type: "header", key: "cf-visitor", value: '.*"scheme"\\s*:\\s*"http".*' }],
    },
    {
      source: "/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png).*)",
      has: [{ type: "host", value: "www\\..+" }],
    },
  ],
};
