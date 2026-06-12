import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Multiple lockfiles exist on this machine (repo root + frontend);
  // pin file tracing to this app so builds stay deterministic.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
