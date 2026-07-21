"use client";

import { useEffect, useState } from "react";
import { accent } from "./palette";

/**
 * Live value of the chart accent color.
 *
 * The appearance palette (settings) recolors the app by overriding the
 * `--accent` CSS custom property via `data-palette` on <html>. CSS-driven marks
 * (`var(--accent)`, `bg-accent`) follow that automatically, but charts drawn
 * with Observable Plot need a concrete hex — they can't take a `var()` — so
 * they'd otherwise stay stuck on the static teal accent when the palette
 * changes.
 *
 * This reads the computed `--accent` off <html> and re-reads it whenever the
 * palette or theme attribute changes (both live on the same element), so a Plot
 * chart using this as its fill recolors in step with the rest of the UI. Falls
 * back to the static accent during SSR / before the first client paint.
 */
export function usePaletteAccent(): string {
  const [color, setColor] = useState(accent);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const value = getComputedStyle(root).getPropertyValue("--accent").trim();
      if (value) setColor(value);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-palette", "data-theme"] });
    return () => observer.disconnect();
  }, []);

  return color;
}
