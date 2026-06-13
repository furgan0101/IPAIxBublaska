import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Multiple lockfiles exist on this machine (repo root + frontend);
  // pin file tracing to this app so builds stay deterministic.
  outputFileTracingRoot: __dirname,
  // Performance: drop the x-powered-by header and gzip responses.
  poweredByHeader: false,
  compress: true,
  // Tree-shake the lucide-react icon barrel (imported across many components)
  // so only the icons actually used ship. Big bundle/runtime win, transparent.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
