import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js ships a native .node binding (PNG export rendering,
  // increment 1.8) that Turbopack can't bundle into an ESM chunk — keep it
  // as a real runtime require() instead.
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
