"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePresentation } from "./presentation-context";

/**
 * Marks a page section as one presentation slide. The children always render
 * here, in place in the page tree — when this slide becomes active the wrapper
 * is promoted to a fixed fullscreen box above the deck backdrop, and when it
 * isn't it's a plain pass-through div (the grid/flex item its children were
 * before). No reparenting or cloning, so chart tooltips, tab selections, and
 * the MapLibre WebGL context survive every slide change; the charts'
 * ResizeObservers re-render them at the promoted width automatically.
 *
 * The inner wrapper div exists in both states so the React tree keeps the
 * same shape — swapping it in only when active would remount the children
 * (and re-init the map) on every promotion.
 */
export function PresentationSlide({
  id,
  title,
  children,
}: {
  /** Stable per-page id, e.g. "geo-comparison". */
  id: string;
  /** Human title shown in the counter, overview grid, and aria-live region. */
  title: string;
  children: ReactNode;
}) {
  const { register, activeSlideId } = usePresentation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return register({ id, title, el });
  }, [id, title, register]);

  const isActive = activeSlideId === id;

  return (
    <div
      ref={ref}
      data-slide-active={isActive || undefined}
      className={
        isActive
          ? // m-auto on the child (not justify-center here) so content taller
            // than the viewport scrolls from the top instead of clipping.
            "fixed inset-0 z-[60] flex overflow-y-auto bg-background px-6 py-16 sm:px-12"
          : undefined
      }
    >
      <div className={isActive ? "m-auto w-full max-w-5xl" : undefined}>{children}</div>
    </div>
  );
}
