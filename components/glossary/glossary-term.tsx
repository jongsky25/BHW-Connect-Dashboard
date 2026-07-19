import type { ReactNode } from "react";
import { GLOSSARY, type GlossaryTermSlug } from "@/lib/glossary/terms";

/**
 * Wraps a technical term with a definition tooltip (CSS-only: visible on
 * hover/focus, no JS). Throws for an unregistered slug — BUILD_PLAN.md §5
 * requires every term used anywhere to exist in lib/glossary, and this is
 * how that's enforced: an unknown reference fails the page that renders it.
 */
export function GlossaryTerm({
  slug,
  children,
}: {
  slug: GlossaryTermSlug;
  children?: ReactNode;
}) {
  const entry = GLOSSARY[slug];
  if (!entry) {
    throw new Error(`Unknown glossary term slug "${slug}" — add it to lib/glossary/terms.ts.`);
  }

  const tooltipId = `glossary-tooltip-${slug}`;

  return (
    <span className="group relative inline-block">
      <span
        tabIndex={0}
        aria-describedby={tooltipId}
        className="cursor-help border-b border-dotted border-muted"
      >
        {children ?? entry.term}
      </span>
      <span
        role="tooltip"
        id={tooltipId}
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-md border border-border bg-background p-2 text-xs font-normal text-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {entry.definition}
      </span>
    </span>
  );
}
