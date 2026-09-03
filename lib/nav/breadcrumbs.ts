/**
 * The site's breadcrumb trails for every static route, in one place.
 *
 * The dashboard is a portal ("/") with three dataset sections beneath it — the
 * 2025 BHW Census ("/bhw"), the 2026 BHW Profiling Status ("/profiling-status")
 * and the 2025 UUC for PHC list ("/uuc-phc") — but only the latter two ever
 * showed that structure on screen. This module makes it explicit everywhere, so
 * no page is a dead end: every trail below is rooted at the portal.
 *
 * Static routes are looked up here and rendered by `SiteBreadcrumbs` from the
 * pathname alone. Dynamic routes (place/area profiles, an admin source viewer)
 * need a database-resolved name in the trail, so they return `null` here and the
 * page builds its own trail from the crumbs this module exports — which is why
 * `trailForPathname` returning `null` means "the page renders its own", not
 * "this page has no breadcrumb".
 */

/**
 * One step in a breadcrumb trail. `href` is omitted for the current page (the
 * last crumb is never a link) and for any label that has no page of its own.
 */
export type Crumb = { label: string; href?: string };

/** The front door every trail starts from. */
export const PORTAL_CRUMB: Crumb = { label: "Equity in Health", href: "/" };

/** Section roots — also the first crumb a dynamic page prepends to its own trail. */
export const BHW_CRUMB: Crumb = { label: "2025 BHW Census", href: "/bhw" };
export const PROFILING_STATUS_CRUMB: Crumb = {
  label: "2026 BHW Profiling Status",
  href: "/profiling-status",
};
export const UUC_PHC_CRUMB: Crumb = { label: "2025 UUC for PHC", href: "/uuc-phc" };

const ADMIN_CRUMB: Crumb = { label: "Admin", href: "/admin" };

/** Trails below the 2025 BHW Census, which uses the shared site header. */
const BHW_TRAILS: Record<string, Crumb[]> = {
  "/bhw": [BHW_CRUMB],
  "/explore": [BHW_CRUMB, { label: "Explore" }],
  "/compare": [BHW_CRUMB, { label: "Compare" }],
  "/methodology": [BHW_CRUMB, { label: "Methodology" }],
  "/glossary": [BHW_CRUMB, { label: "Glossary" }],
  "/data-quality": [BHW_CRUMB, { label: "Data quality" }],
  "/districts": [BHW_CRUMB, { label: "Districts" }],
  "/roadmap": [BHW_CRUMB, { label: "Roadmap" }],
  "/privacy": [BHW_CRUMB, { label: "Privacy" }],
  "/feedback": [BHW_CRUMB, { label: "Feedback" }],
};

/** Admin screens sit under the census section; labels mirror `AdminNav`. */
const ADMIN_TRAILS: Record<string, Crumb[]> = {
  "/admin": [BHW_CRUMB, { label: "Admin" }],
  "/admin/login": [BHW_CRUMB, { label: "Admin sign-in" }],
  "/admin/feedback": [BHW_CRUMB, ADMIN_CRUMB, { label: "Feedback" }],
  "/admin/usage": [BHW_CRUMB, ADMIN_CRUMB, { label: "Usage" }],
  "/admin/changelog": [BHW_CRUMB, ADMIN_CRUMB, { label: "Changelog" }],
  "/admin/ingestion": [BHW_CRUMB, ADMIN_CRUMB, { label: "Ingestion history" }],
  "/admin/ai-quota": [BHW_CRUMB, ADMIN_CRUMB, { label: "AI quota" }],
  "/admin/answer-bank": [BHW_CRUMB, ADMIN_CRUMB, { label: "Answer bank" }],
  "/admin/assistant": [BHW_CRUMB, ADMIN_CRUMB, { label: "Assistant" }],
  "/admin/kb-review": [BHW_CRUMB, ADMIN_CRUMB, { label: "KB review" }],
  "/admin/regressions": [BHW_CRUMB, ADMIN_CRUMB, { label: "Regressions" }],
};

const PROFILING_STATUS_TRAILS: Record<string, Crumb[]> = {
  "/profiling-status": [PROFILING_STATUS_CRUMB],
  "/profiling-status/methodology": [PROFILING_STATUS_CRUMB, { label: "Methodology" }],
};

const UUC_PHC_TRAILS: Record<string, Crumb[]> = {
  "/uuc-phc": [UUC_PHC_CRUMB],
  "/uuc-phc/criteria": [UUC_PHC_CRUMB, { label: "Qualifying criteria" }],
  "/uuc-phc/bhw-coverage": [UUC_PHC_CRUMB, { label: "BHW coverage" }],
  "/uuc-phc/indicators": [UUC_PHC_CRUMB, { label: "Indicators" }],
  "/uuc-phc/data-quality": [UUC_PHC_CRUMB, { label: "Data quality" }],
  "/uuc-phc/methodology": [UUC_PHC_CRUMB, { label: "Methodology" }],
};

const STATIC_TRAILS: Record<string, Crumb[]> = {
  ...BHW_TRAILS,
  ...ADMIN_TRAILS,
  ...PROFILING_STATUS_TRAILS,
  ...UUC_PHC_TRAILS,
};

/**
 * The trail for a static route, rooted at the portal — or `null` when the route
 * supplies its own (a dynamic page needing a resolved geo name) or is itself the
 * portal, which is where every trail already points.
 *
 * A trailing slash is tolerated because `usePathname()` reflects whatever the
 * visitor typed.
 */
export function trailForPathname(pathname: string): Crumb[] | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;

  // The admin source viewer is dynamic but its label never is — the chunk id it
  // is keyed by is not something to show in a trail.
  if (path.startsWith("/admin/assistant/source/")) {
    return [
      PORTAL_CRUMB,
      BHW_CRUMB,
      ADMIN_CRUMB,
      { label: "Assistant", href: "/admin/assistant" },
      { label: "Source" },
    ];
  }

  const trail = STATIC_TRAILS[path];
  return trail ? [PORTAL_CRUMB, ...trail] : null;
}
