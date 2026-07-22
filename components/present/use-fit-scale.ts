"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * Upper bound on the auto-fit zoom. Past this the text is already huge on any
 * real projector/LED wall, and pushing further only risks blowing sparse slides
 * (a single stat) up to a cartoonish size — so sparse slides cap here rather
 * than filling every last pixel.
 */
const MAX_SCALE = 2.6;

/**
 * Auto-fit a presentation slide to the screen for large-crowd / LED-wall
 * legibility.
 *
 * The slide content is laid out at a fixed *design width* and then scaled up
 * with CSS `zoom` to the largest factor that still fits the fullscreen frame
 * (both width and height). Because `zoom` scales the whole subtree uniformly —
 * fonts, padding, and fixed-rem column widths alike — text gets as big as the
 * screen allows while every layout relationship is preserved, so nothing can
 * overlap that didn't already. It never scales *below* 1 (a slide too tall to
 * fit just keeps its normal size and scrolls, exactly as before), so this is
 * purely additive: on a big screen the type grows; on a laptop it's unchanged.
 *
 * `zoom` (unlike `transform: scale`) reflows, so the surrounding `m-auto`
 * centring and the frame's `overflow-y-auto` scrolling keep working untouched.
 * Charts are vector (Observable Plot / SVG) and the map is re-measured at the
 * design width, so both stay crisp when magnified.
 *
 * @param active       Whether this slide is the one currently promoted.
 * @param designWidth  Layout width (px) the content is composed at before zoom.
 * @returns frameRef (put on the fixed, padded fullscreen box) and contentRef
 *          (put on the centred inner wrapper that should grow).
 */
export function useFitScale(active: boolean, designWidth: number) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    // Inactive slides render as plain in-page pass-throughs — strip any zoom
    // from a previous promotion so they lay out exactly as they did before.
    if (!active) {
      content.style.removeProperty("width");
      content.style.removeProperty("zoom");
      return;
    }

    const frame = frameRef.current;
    if (!frame) return;

    let raf = 0;
    const apply = () => {
      const cs = getComputedStyle(frame);
      const availW =
        frame.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH =
        frame.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      if (availW <= 0 || availH <= 0) return;

      // Compose at the design width (or the screen, if narrower), then measure
      // the natural height at zoom 1 before choosing the fit scale.
      const w = Math.min(designWidth, availW);
      content.style.setProperty("width", `${w}px`);
      content.style.setProperty("zoom", "1");
      const ch = content.scrollHeight;
      if (ch <= 0) return;

      const scale = Math.min(availW / w, availH / ch, MAX_SCALE);
      content.style.setProperty("zoom", String(Math.max(1, scale)));
    };

    // rAF-coalesce so a burst of resize/observer callbacks does one measure.
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };

    apply();
    // Observe only the (never-zoomed) frame: it changes with the viewport but
    // not with our own zoom writes, so there's no measure/zoom feedback loop.
    const observer = new ResizeObserver(schedule);
    observer.observe(frame);
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      content.style.removeProperty("width");
      content.style.removeProperty("zoom");
    };
  }, [active, designWidth]);

  return { frameRef, contentRef };
}
