"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Hides shared site chrome on pages that supply their own slim footer: the portal landing
 * ("/"), the 2026 BHW Profiling Status section ("/profiling-status/*"), the UUC for PHC
 * section ("/uuc-phc/*") and the health facilities section ("/facilities/*"). Everywhere else the
 * children render normally. `usePathname()` is populated during SSR, so those pages' server
 * HTML already omits the wrapped (async) Footer — no flash, no hydration mismatch.
 */
export function FooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname.startsWith("/profiling-status") ||
    pathname.startsWith("/uuc-phc") ||
    pathname.startsWith("/facilities")
  )
    return null;
  return <>{children}</>;
}
