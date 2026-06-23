import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";
const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Pin Turbopack root to frontend/ — avoids scanning the whole monorepo when a
  // stray package-lock.json exists at the repo root (e.g. accidental npm install).
  turbopack: {
    root: frontendRoot,
  },
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
