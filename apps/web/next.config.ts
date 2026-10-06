import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: `next build` emits plain HTML/JS/CSS into `out/`, which the
  // Cloudflare Worker serves as static assets (free + unlimited requests).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Shared domain code is consumed as TypeScript source.
  transpilePackages: ["@smp/core"],
};

export default nextConfig;
