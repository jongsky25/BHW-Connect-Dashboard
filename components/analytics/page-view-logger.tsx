"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { logEvent } from "@/lib/usage/log-client";

/** Mounted once in the root layout — logs one page_view event per route change. */
export function PageViewLogger() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    logEvent("page_view", {
      pagePath: pathname,
      geoCode: searchParams.get("geoCode") ?? undefined,
    });
    // Only re-fire when the actual URL changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams.toString()]);

  return null;
}
