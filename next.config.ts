import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Usage is read at runtime. Personal snapshots and environment files must never be deployed.
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./.env*"] },
  // Retired pages. Older installers still print /share, so keep these working.
  async redirects() {
    return [
      { source: "/share", destination: "/edit", permanent: false },
      { source: "/github-profile", destination: "/edit", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default nextConfig;
