"use client";

import { useEffect, useState } from "react";
import type { DeckMeta, SlideInfo } from "./presentation-context";
import { useFitScale } from "./use-fit-scale";

/** The generated title/closing slides are composed at max-w-3xl (48rem) before
 * the fit-to-screen zoom. */
const TEXT_SLIDE_DESIGN_WIDTH = 768;

/**
 * All presentation chrome: the opaque backdrop the inactive page sits under,
 * the generated title/closing slides, the bottom controls bar, the edge
 * prev/next buttons, and the jump-to-slide overview. Pure props component —
 * the provider owns all state. Layering (content slides promote to z-60):
 * backdrop 50 < slides 60 < controls 70 < overview 80.
 */
export function PresentationDeck({
  meta,
  slides,
  index,
  count,
  overviewOpen,
  onNext,
  onPrev,
  onGoTo,
  onExit,
  onToggleOverview,
}: {
  meta: DeckMeta;
  slides: SlideInfo[];
  index: number;
  count: number;
  overviewOpen: boolean;
  onNext: () => void;
  onPrev: () => void;
  onGoTo: (index: number) => void;
  onExit: () => void;
  onToggleOverview: () => void;
}) {
  // Whether true fullscreen is currently held — drives the re-enter button
  // shown when the browser denied the request (or has no Fullscreen API).
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Fit-to-screen zoom for the generated title/closing slides, mirroring the
  // content slides so every slide reads at the same large size on an LED wall.
  const { frameRef: titleFrameRef, contentRef: titleContentRef } = useFitScale(
    index === 0,
    TEXT_SLIDE_DESIGN_WIDTH,
  );
  const { frameRef: closingFrameRef, contentRef: closingContentRef } = useFitScale(
    index === count - 1,
    TEXT_SLIDE_DESIGN_WIDTH,
  );

  const slideLabel =
    index === 0 ? "Title" : index === count - 1 ? "Closing" : (slides[index - 1]?.title ?? "");
  const presentedDate = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      {/* Opaque backdrop: the page (and every inactive slide) sits invisibly beneath. */}
      <div aria-hidden className="fixed inset-0 z-50 bg-background" />

      <div aria-live="polite" className="sr-only">
        Slide {index + 1} of {count}: {slideLabel}
      </div>

      {index === 0 && (
        <div
          ref={titleFrameRef}
          className="fixed inset-0 z-[60] flex overflow-y-auto bg-background px-6 py-16 sm:px-12"
        >
          <div
            ref={titleContentRef}
            className="m-auto flex w-full max-w-3xl flex-col items-center gap-4 text-center"
          >
            <p className="text-sm font-medium tracking-wide text-muted uppercase">
              {meta.pageLabel}
            </p>
            <h1 className="text-3xl font-bold tracking-tight">{meta.areaName}</h1>
            {meta.filterChips.length > 0 && (
              <ul className="flex flex-wrap justify-center gap-2">
                {meta.filterChips.map((chip) => (
                  <li
                    key={chip}
                    className="rounded-full border border-border bg-accent-subtle px-3 py-1 text-xs font-medium text-accent"
                  >
                    {chip}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-sm text-muted">{meta.captionLine}</p>
            <p className="text-sm text-muted">{presentedDate}</p>
            <p className="mt-6 text-xs text-muted">
              Use <kbd className="rounded border border-border px-1">→</kbd> and{" "}
              <kbd className="rounded border border-border px-1">←</kbd> to navigate ·{" "}
              <kbd className="rounded border border-border px-1">Esc</kbd> to exit
            </p>
          </div>
        </div>
      )}

      {index === count - 1 && (
        <div
          ref={closingFrameRef}
          className="fixed inset-0 z-[60] flex overflow-y-auto bg-background px-6 py-16 sm:px-12"
        >
          <div
            ref={closingContentRef}
            className="m-auto flex w-full max-w-3xl flex-col items-center gap-4 text-center"
          >
            <h1 className="text-3xl font-bold tracking-tight">Thank you</h1>
            <p className="text-sm text-muted">
              Data: BHW Connect · {meta.captionLine} · presented {presentedDate}
            </p>
            <button
              type="button"
              onClick={onExit}
              className="mt-4 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      )}

      {/* Edge prev/next: compact centered buttons, not full-height click zones,
          so they never swallow map drags or chart hovers on the slide. */}
      <button
        type="button"
        onClick={onPrev}
        disabled={index === 0}
        aria-label="Previous slide"
        className="fixed top-1/2 left-3 z-[70] -translate-y-1/2 rounded-full border border-border bg-background/90 px-3.5 py-2.5 text-lg shadow-md hover:bg-surface disabled:opacity-30 disabled:hover:bg-background/90"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={index === count - 1}
        aria-label="Next slide"
        className="fixed top-1/2 right-3 z-[70] -translate-y-1/2 rounded-full border border-border bg-background/90 px-3.5 py-2.5 text-lg shadow-md hover:bg-surface disabled:opacity-30 disabled:hover:bg-background/90"
        // Presenters start focused on "next"; Tab reaches the live slide content from here.
        autoFocus
      >
        ›
      </button>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex items-center justify-between gap-3 px-4 py-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit presentation"
            className="rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-sm text-muted shadow-sm hover:bg-surface"
          >
            ✕
          </button>
          <span className="rounded-md bg-background/90 px-2 py-1 text-sm tabular-nums text-muted">
            {index + 1} / {count}
          </span>
        </div>

        <div
          className="pointer-events-auto hidden items-center gap-1.5 sm:flex"
          role="group"
          aria-label="Slide progress"
        >
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onGoTo(i)}
              aria-label={`Go to slide ${i + 1}${
                i === 0
                  ? ": Title"
                  : i === count - 1
                    ? ": Closing"
                    : `: ${slides[i - 1]?.title ?? ""}`
              }`}
              aria-current={i === index ? "true" : undefined}
              className={`size-2.5 rounded-full transition-colors ${
                i === index ? "bg-accent" : "bg-border hover:bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {!isFullscreen && (
            <button
              type="button"
              onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
              className="rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-sm text-muted shadow-sm hover:bg-surface"
            >
              Fullscreen
            </button>
          )}
          <button
            type="button"
            onClick={onToggleOverview}
            aria-expanded={overviewOpen}
            className="rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-sm text-muted shadow-sm hover:bg-surface"
          >
            Overview
          </button>
        </div>
      </div>

      {overviewOpen && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-background/95 px-6 py-16">
          <div className="mx-auto w-full max-w-4xl">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">All slides</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: count }, (_, i) => {
                const title =
                  i === 0 ? "Title" : i === count - 1 ? "Closing" : (slides[i - 1]?.title ?? "");
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onGoTo(i)}
                    className={`rounded-md border px-3 py-2 text-left text-sm hover:bg-surface ${
                      i === index
                        ? "border-accent bg-accent-subtle font-medium text-accent"
                        : "border-border"
                    }`}
                  >
                    <span className="mr-2 tabular-nums text-muted">{i + 1}.</span>
                    {title}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
