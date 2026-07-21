"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Hides shared site chrome on the portal landing page ("/"), which supplies its
 * own slim footer. Everywhere else the children render normally. `usePathname()`
 * is populated during SSR, so the portal's server HTML already omits the wrapped
 * (async) Footer — no flash, no hydration mismatch.
 */
export function FooterGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <>{children}</>;
}
