"use client";

import { useState } from "react";
import { StackedMiniBar } from "@/components/home/mini-viz";
import { StatEnlargeModal, type StatEnlarge } from "@/components/home/stat-tile";

/** The large "Total BHWs" hero KPI card — spans 2 grid columns, leads the
 * home page's F-pattern KPI strip with the single most important number. */
export function StatHero({
  label,
  value,
  caption,
  registrationMix,
  enlarge,
}: {
  label: string;
  value: string;
  caption: string;
  /** Registered / registered & accredited / non-registered, for the mini-bar. */
  registrationMix?: { label: string; value: number; color: string }[];
  enlarge?: StatEnlarge;
}) {
  const [open, setOpen] = useState(false);

  const body = (
    <>
      <p className="mt-1 text-[3rem] font-semibold tracking-tight sm:text-[3.5rem]">{value}</p>
      {registrationMix && (
        <div className="mt-3">
          <StackedMiniBar
            segments={registrationMix}
            ariaLabel={registrationMix.map((s) => `${s.label} ${s.value.toLocaleString()}`).join(", ")}
          />
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{caption}</p>
    </>
  );

  if (!enlarge) {
    return (
      <div className="rounded-lg border border-border bg-background p-5 sm:col-span-2 sm:p-6">
        <p className="text-base text-muted">{label}</p>
        {body}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-border bg-background p-5 text-left transition-colors hover:border-accent sm:col-span-2 sm:p-6"
      >
        <span className="flex items-center justify-between text-base text-muted">
          {label}
          <span className="text-xs text-muted" aria-hidden="true">
            Enlarge ⤢
          </span>
        </span>
        {body}
      </button>
      <StatEnlargeModal enlarge={enlarge} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
