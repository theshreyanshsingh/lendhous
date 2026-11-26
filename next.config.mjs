/**
 * scripts/deploy.sh builds the next version into .next-build while the running server keeps serving .next, then swaps
 * the two and restarts, so a failed build never touches the live site. Only that folder is accepted. Its type check
 * reads tsconfig.deploy.json, which takes .next-build's route types and not the live build's, whose would clash.
 */
export function buildDir(env = process.env) {
  const dir = env.LENDHOUS_BUILD_DIR || ".next";
  if (dir !== ".next" && dir !== ".next-build") throw new Error("LENDHOUS_BUILD_DIR may only be .next-build (see scripts/deploy.sh).");
  return dir;
}

const distDir = buildDir();

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir,
  typescript: { tsconfigPath: distDir === ".next" ? "tsconfig.json" : "tsconfig.deploy.json" },
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Loan files and draw photos go through a server action, whose default limit of 1 MB would refuse most of them.
    // lib/uploads.ts sets the real limit of 15 MB; this leaves room for the form around the file.
    serverActions: { bodySizeLimit: "16mb" },
    // The signed-in panel's uploads pass through middleware (middleware.ts), which gets a copy of the body that Next
    // cuts off at 10 MB by default, and the action then reads the cut copy. The same room as the action's limit.
    middlewareClientMaxBodySize: "16mb",
  },
  // pdfkit reads its font metrics from its own folder at run time, which bundling would lose.
  serverExternalPackages: ["pdfkit"],
  // Every page's title, description and icons go in the <head> of the HTML, for every visitor. By default Next 15
  // streams them into the <body> for anything but a short list of crawlers (browsers move them up with JavaScript), so
  // link previews, scanners and other tools that read the HTML found pages without a title in the head.
  htmlLimitedBots: /.*/,
  headers: async () => [
    { source: "/:path*", headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    // No other site may frame LendHous's pages, except the quote widget, which exists to be framed (/embed/quote).
    { source: "/((?!embed/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }, { key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] },
    { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
    // The address of these pages is the key to them, so it must not reach another site or a search engine.
    { source: "/photos/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/apply/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/payoff-letter/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/closing/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/insurance/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/login/set-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
  ],
  // The marketing site's old portal address now leads to the real sign-in page.
  redirects: async () => [{ source: "/portal/:path*", destination: "/login", permanent: false }],
};
export default nextConfig;
