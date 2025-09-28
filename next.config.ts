import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true, // ignore ESLint errors during builds
  },
  outputFileTracingRoot: __dirname, // ensures Next.js traces src correctly
};

export default nextConfig;
