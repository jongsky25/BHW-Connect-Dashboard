import type { ReactNode } from "react";
import { ExploreNavProvider } from "@/components/explore/explore-nav";

/**
 * Wraps the Explore route in a shared navigation transition so filter changes
 * (cascade, chips, map drills) drive one top progress bar during the RSC
 * re-render (E0.6). Scoped here rather than globally.
 */
export default function ExploreLayout({ children }: { children: ReactNode }) {
  return <ExploreNavProvider>{children}</ExploreNavProvider>;
}
