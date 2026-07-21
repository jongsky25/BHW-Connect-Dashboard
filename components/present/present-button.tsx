"use client";

import { usePresentation } from "./presentation-context";

/**
 * Starts presentation mode. Renders nothing until at least one slide has
 * registered (slides register in client effects, so this is also what keeps
 * server and first-client render identical — both null).
 */
export function PresentButton({ variant = "primary" }: { variant?: "primary" | "secondary" }) {
  const { start, slides } = usePresentation();
  if (slides.length === 0) return null;
  return (
    <button
      type="button"
      onClick={start}
      className={
        variant === "primary"
          ? "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
          : "rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface"
      }
    >
      ▶ Present
    </button>
  );
}
