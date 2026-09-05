import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteBreadcrumbs } from "@/components/layout/site-breadcrumbs";

// Its own dataset and its own section, distinct from the BHW Census, the 2026 Profiling Status
// and the UUC for PHC list — so it carries its own title template rather than the root layout's
// "%s · BHW Connect", and supplies its own slim chrome. The shared BHW header/footer suppress
// themselves on /facilities/* (see components/layout/header.tsx + footer-gate.tsx).
export const metadata: Metadata = {
  title: {
    default: "Health facilities",
    template: "%s · Health facilities",
  },
  description:
    "The DOH National Health Facility Registry — which health facilities are where, from national down to city/municipality level, and which barangays have none.",
};

function SectionHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3 sm:px-6">
        <Link
          href="/facilities"
          className="order-1 flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="equity-mark sm" aria-hidden="true" />
          <span>Health facilities</span>
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
            Sep 2026
          </span>
        </Link>
        <Link
          href="/"
          className="order-2 ml-auto shrink-0 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-foreground lg:order-3 lg:ml-0"
        >
          ← Portal
        </Link>
        <nav
          aria-label="Health facilities"
          className="order-3 -my-1 flex w-full items-center gap-1 overflow-x-auto py-1 text-sm lg:order-2 lg:my-0 lg:ml-auto lg:w-auto lg:overflow-x-visible lg:py-0"
        >
          <Link
            href="/facilities"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Overview
          </Link>
          <Link
            href="/facilities/methodology"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Methodology
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SectionFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 text-sm text-muted sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="equity-mark sm" aria-hidden="true" />
          <span>
            Source: DOH National Health Facility Registry (nhfr.doh.gov.ph), snapshot as of
            September 2026, retrieved 5 September 2026. Places, not people: contact details in the
            source are not published here.
          </span>
          <Link href="/" className="underline hover:text-accent">
            Equity in Health portal
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default function FacilitiesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SectionHeader />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {/* Static routes get their trail from the pathname; the area pages below need a resolved
            geo name, so they render their own in the same spot. */}
        <SiteBreadcrumbs className="mb-8" />
        {children}
      </div>
      <SectionFooter />
    </div>
  );
}
