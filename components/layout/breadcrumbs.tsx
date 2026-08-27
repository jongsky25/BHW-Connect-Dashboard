import Link from "next/link";
import type { Crumb } from "@/lib/nav/breadcrumbs";

/**
 * The site's one breadcrumb rendering, shared by every section.
 *
 * Every trail starts at the Equity in Health portal ("/"), so any page — a BHW
 * Census sub-page, a UUC for PHC area profile, an admin screen — always shows a
 * route back to the front door. Before this existed, the census section ("/bhw"
 * and its sub-pages) had no on-screen way back to the portal at all: the shared
 * header's "Home" points at /bhw, and the only portal link sat in the footer,
 * below a very long page.
 *
 * Markup is a `nav > ol` with the last crumb marked `aria-current="page"`;
 * separators are decorative. Styling matches the trails the UUC for PHC and
 * Profiling Status sections had grown independently ("›", text-sm muted, the
 * current page in foreground weight), which this replaces.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={`text-sm text-muted ${className ?? ""}`}>
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((crumb, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={`${crumb.href ?? "crumb"}-${crumb.label}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">›</span>}
              {crumb.href && !isLast ? (
                <Link href={crumb.href} className="hover:text-accent hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={isLast ? "font-medium text-foreground" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
