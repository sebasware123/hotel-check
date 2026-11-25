import type { NextConfig } from "next";

const apiOrigin = (process.env.GO_API_URL ?? "http://localhost:8080").replace(/\/$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiOrigin}/api/:path*` },
      { source: "/backend-healthz", destination: `${apiOrigin}/healthz` },
      { source: "/metrics", destination: `${apiOrigin}/metrics` },
    ];
  },
};

export default nextConfig;
