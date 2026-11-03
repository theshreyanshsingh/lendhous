/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Loan files and draw photos go through a server action, whose default limit of 1 MB would refuse most of them.
  // lib/uploads.ts sets the real limit of 15 MB; this leaves room for the form around the file.
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  // pdfkit reads its font metrics from its own folder at run time, which bundling would lose.
  serverExternalPackages: ["pdfkit"],
  headers: async () => [
    { source: "/:path*", headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    // The address of these pages is the key to them, so it must not reach another site or a search engine.
    { source: "/photos/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/apply/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/payoff-letter/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/closing/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "no-store" }] },
    { source: "/login/set-password", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
  ],
  // The marketing site's old portal address now leads to the real sign-in page.
  redirects: async () => [{ source: "/portal/:path*", destination: "/login", permanent: false }],
};
export default nextConfig;
