import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @resvg/resvg-js ships a native .node binding (PNG export rendering,
  // increment 1.8) that Turbopack can't bundle into an ESM chunk — keep it
  // as a real runtime require() instead.
  serverExternalPackages: ["@resvg/resvg-js"],

  // Place pages read boundary GeoJSON from public/geo at render time
  // (lib/geo/locator.ts). Regions/provinces are SSG'd at build where the
  // files exist on disk, but citymun/barangay pages are ISR'd in a
  // serverless function — without this include the tracer wouldn't bundle
  // public/ files into the function and the locator would silently vanish.
  outputFileTracingIncludes: {
    "/place/[geoLevel]/[geoCode]": ["./public/geo/**/*"],
  },
};

export default nextConfig;
