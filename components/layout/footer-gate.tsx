"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Hides shared site chrome on pages that supply their own slim footer: the portal landing
 * ("/"), the 2026 BHW Profiling Status section ("/profiling-status/*") and the UUC for PHC
 * section ("/uuc-phc/*"). Everywhere else the
 * children render normally. `usePathname()` is populated during SSR, so those pages' server
 * HTML already omits the wrapped (async) Footer — no flash, no hydration mismatch.
 */
export function FooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname.startsWith("/profiling-status") ||
    pathname.startsWith("/uuc-phc")
  )
    return null;
  return <>{children}</>;
}
