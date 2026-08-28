import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteBreadcrumbs } from "@/components/layout/site-breadcrumbs";
import { ListCorrection } from "@/components/uuc-phc/list-correction";

// Its own dataset and its own section, distinct from the BHW Census and the 2026 Profiling
// Status — so it carries its own title template rather than the root layout's "%s · BHW Connect",
// and supplies its own slim chrome. The shared BHW header/footer suppress themselves on
// /uuc-phc/* (see components/layout/header.tsx + footer-gate.tsx), mirroring /profiling-status.
export const metadata: Metadata = {
  title: {
    default: "UUC for PHC 2025",
    template: "%s · UUC for PHC 2025",
  },
  description:
    "The 2025 list of Unserved and Underserved Communities for Primary Health Care — which barangays are on it, from national down to city/municipality level.",
};

function SectionHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3 sm:px-6">
        <Link
          href="/uuc-phc"
          className="order-1 flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="equity-mark sm" aria-hidden="true" />
          <span>UUC for PHC</span>
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
            2025
          </span>
        </Link>
        {/* The way back up to the portal keeps a row of its own on narrow screens:
            the section nav below has more links than a phone is wide, so it scrolls
            sideways — and a return link parked at the end of a scrolling row is the
            one link you can never reach. Only at lg do all seven links fit on one
            row, and there it sits at the end of the nav, where it has always been. */}
        <Link
          href="/"
          className="order-2 ml-auto shrink-0 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface hover:text-foreground lg:order-3 lg:ml-0"
        >
          ← Portal
        </Link>
        <nav
          aria-label="UUC for PHC"
          className="order-3 -my-1 flex w-full items-center gap-1 overflow-x-auto py-1 text-sm lg:order-2 lg:my-0 lg:ml-auto lg:w-auto lg:overflow-x-visible lg:py-0"
        >
          <Link
            href="/uuc-phc"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Overview
          </Link>
          <Link
            href="/uuc-phc/criteria"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Criteria
          </Link>
          <Link
            href="/uuc-phc/indicators"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Indicators
          </Link>
          <Link
            href="/uuc-phc/bhw-coverage"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            BHW coverage
          </Link>
          <Link
            href="/uuc-phc/data-quality"
            className="shrink-0 whitespace-nowrap rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Data quality
          </Link>
          <Link
            href="/uuc-phc/methodology"
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
            Source: DOH Bureau of Local Health Systems Development — 2025 list of Unserved and
            Underserved Communities for Primary Health Care (DC No. 2025-0549). Places, not people:
            no personal data.
          </span>
          <Link href="/" className="underline hover:text-accent">
            Equity in Health portal
          </Link>
        </div>
        <ListCorrection />
      </div>
    </footer>
  );
}

export default function UucPhcLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SectionHeader />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {/* Static routes get their trail from the pathname; the area pages below
            need a resolved geo name, so they render their own in the same spot. */}
        <SiteBreadcrumbs className="mb-8" />
        {children}
      </div>
      <SectionFooter />
    </div>
  );
}
