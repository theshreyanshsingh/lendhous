/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // The marketing site's old portal address now leads to the real sign-in page.
  redirects: async () => [{ source: "/portal/:path*", destination: "/login", permanent: false }],
};
export default nextConfig;
