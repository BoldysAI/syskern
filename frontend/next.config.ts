import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  // Prevent Next.js from redirecting /api/foo/ → /api/foo before the rewrite runs.
  skipTrailingSlashRedirect: true,
  // Prevent Next.js from re-encoding already-encoded URL segments in rewrite
  // destinations (BFF proxy pattern — backend owns the URL as-is).
  skipProxyUrlNormalize: true,
  async rewrites() {
    return [
      {
        // :path(.*) uses regex .* which captures trailing slashes,
        // unlike :path* which strips them.
        source: "/api/:path(.*)",
        destination: `${BACKEND_URL}/api/:path`,
      },
    ];
  },
};

export default nextConfig;
