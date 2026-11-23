/**
 * Where a request belongs, if not where it came in: plain http through Cloudflare, or the www host, go to the site's own
 * https address (NEXT_PUBLIC_APP_URL) with the same path and query.
 *
 * Cloudflare says which scheme the visitor used in its CF-Visitor header ({"scheme":"http"}). X-Forwarded-Proto isn't
 * used: a proxy between Cloudflare and the app can set it to http on every request, which would redirect forever.
 * Nothing changes without an https site address (a local or internal server), or for a request that didn't come
 * through Cloudflare over http and isn't on www.
 */
export function canonicalUrl(request: { host: string | null; path: string; search: string; cfVisitor: string | null }, siteUrl: string | undefined): string | null {
  const site = httpsOrigin(siteUrl);
  if (!site) return null;
  const host = (request.host ?? "").trim().toLowerCase();
  const onWww = host.startsWith("www.");
  if (!onWww && visitorScheme(request.cfVisitor) !== "http") return null;
  return `${site.origin}${request.path || "/"}${request.search}`;
}

function httpsOrigin(siteUrl: string | undefined) {
  try {
    const url = new URL((siteUrl ?? "").trim());
    return url.protocol === "https:" && !url.hostname.startsWith("www.") ? url : null;
  } catch {
    return null;
  }
}

function visitorScheme(header: string | null) {
  if (!header) return "";
  try {
    const parsed: unknown = JSON.parse(header);
    return parsed && typeof parsed === "object" && "scheme" in parsed && typeof parsed.scheme === "string" ? parsed.scheme.toLowerCase() : "";
  } catch {
    return "";
  }
}
