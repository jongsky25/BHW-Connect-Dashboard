import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

// This section is its own dataset, distinct from the 2025 BHW Census — so it carries its own
// title template instead of the root layout's "%s · BHW Connect". The shared BHW header/footer
// are suppressed on /profiling-status/* (see components/layout/header.tsx + footer-gate.tsx);
// this layout supplies the section's own slim chrome, mirroring the portal's approach on "/".
export const metadata: Metadata = {
  title: {
    default: "BHW Profiling Status 2026",
    template: "%s · BHW Profiling Status 2026",
  },
  description:
    "How far the 2026 Barangay Health Worker individual-profiling exercise has progressed — Encode → Validate → Certify — across the Philippines.",
};

function SectionHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/profiling-status"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="equity-mark sm" aria-hidden="true" />
          <span>BHW Profiling Status</span>
          <span className="rounded-full bg-accent-subtle px-2 py-0.5 text-xs font-medium text-accent">
            2026
          </span>
        </Link>
        <nav aria-label="Profiling status" className="flex items-center gap-1 text-sm">
          <Link href="/profiling-status" className="rounded-md px-3 py-2 font-medium hover:bg-surface">
            Overview
          </Link>
          <Link
            href="/profiling-status/methodology"
            className="rounded-md px-3 py-2 font-medium hover:bg-surface"
          >
            Methodology
          </Link>
          <Link
            href="/"
            className="rounded-md px-3 py-2 text-muted hover:bg-surface hover:text-foreground"
          >
            ← Portal
          </Link>
        </nav>
      </div>
    </header>
  );
}

function SectionFooter() {
  return (
    <footer className="mt-auto border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-sm text-muted sm:px-6">
        <span className="equity-mark sm" aria-hidden="true" />
        <span>
          Source: DOH BHW Connect — 2026 individual-profiling encoding status. Aggregate counts
          only, no personal data.
        </span>
        <Link href="/" className="underline hover:text-accent">
          Equity in Health portal
        </Link>
      </div>
    </footer>
  );
}

export default function ProfilingStatusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <SectionHeader />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</div>
      <SectionFooter />
    </div>
  );
}
