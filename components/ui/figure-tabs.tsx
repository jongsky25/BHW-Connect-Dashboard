"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type FigureTab = { id: string; label: string; content: ReactNode };

/**
 * Groups sibling figures that tell one story into a single tabbed unit
 * (HOME_SEARCH_REVIEW.md item 16 / D9: back-to-back cards with identical
 * rhythm read as repetition). Panels are server-rendered children passed
 * through as props; inactive ones are hidden rather than unmounted so
 * per-figure state (view/period toggles) survives tab switches, and each
 * chart's ResizeObserver re-measures it the moment its panel is revealed.
 * Tab strip styling mirrors ViewToggle/PeriodToggle's segmented control.
 */
export function FigureTabs({ heading, tabs }: { heading: string; tabs: FigureTab[] }) {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = (index: number) => {
    setActive(index);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + last) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    focusTab(target);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
        <div
          role="tablist"
          aria-label={heading}
          className="inline-flex rounded-md border border-border p-0.5 text-xs"
        >
          {tabs.map((tab, i) => {
            const isActive = i === active;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`${baseId}-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(event) => onKeyDown(event, i)}
                className={
                  isActive
                    ? "rounded px-2 py-1 font-medium bg-accent text-accent-foreground"
                    : "rounded px-2 py-1 text-muted hover:text-foreground"
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={i !== active}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
