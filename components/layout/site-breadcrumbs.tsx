"use client";

import { usePathname } from "next/navigation";
import { Breadcrumbs } from "./breadcrumbs";
import { trailForPathname } from "@/lib/nav/breadcrumbs";

/**
 * The breadcrumb trail for the current static route, derived from the pathname
 * alone so no page has to wire one up by hand.
 *
 * Renders nothing on the portal and on dynamic routes, which build their own
 * trail from a database-resolved name (see `lib/nav/breadcrumbs.ts`) — so a page
 * never shows two trails. `usePathname()` is populated during SSR, matching how
 * `Header`/`FooterGate` already gate shared chrome: no flash, no hydration
 * mismatch.
 */
export function SiteBreadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname();
  const items = trailForPathname(pathname);
  if (!items) return null;
  return <Breadcrumbs items={items} className={className} />;
}

/**
 * `SiteBreadcrumbs` as a slim bar under the shared site header, for the 2025 BHW
 * Census section (which has no per-section content container of its own — each
 * page brings its own). The wrapper lives inside the gate so a route without a
 * static trail leaves no empty bordered strip behind.
 */
export function SiteBreadcrumbBar() {
  const pathname = usePathname();
  const items = trailForPathname(pathname);
  if (!items) return null;

  return (
    <div className="border-t border-border bg-surface/40">
      <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
        <Breadcrumbs items={items} />
      </div>
    </div>
  );
}
