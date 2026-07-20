"use client";

import { getSessionId } from "@/lib/feedback/session";

function doNotTrackEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.doNotTrack === "1" || (window as unknown as { doNotTrack?: string }).doNotTrack === "1";
}

/**
 * Fire-and-forget usage event logging (BUILD_PLAN.md §5/§7 1.9) — anonymized
 * (session UUID, no PII), respects Do Not Track, never blocks or throws for
 * the caller. Posts to api/log, which salts+truncates the IP server-side.
 */
type MetaValue = string | number | boolean | null | undefined;

export function logEvent(
  eventType: string,
  options: { pagePath?: string; geoCode?: string; meta?: Record<string, MetaValue> } = {},
) {
  if (doNotTrackEnabled()) return;

  try {
    const body = JSON.stringify({
      sessionId: getSessionId(),
      eventType,
      pagePath: options.pagePath ?? window.location.pathname,
      geoCode: options.geoCode,
      meta: options.meta,
    });
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never let logging failures affect the page.
  }
}
