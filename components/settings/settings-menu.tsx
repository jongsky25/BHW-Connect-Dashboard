"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "./settings-provider";
import {
  FONT_SIZE_OPTIONS,
  PALETTE_OPTIONS,
  THEME_OPTIONS,
  type FontSize,
  type Palette,
  type ThemeMode,
} from "./settings-types";

/** Small segmented control shared by the theme and font-size rows. */
function SegmentedGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.value)}
              className={
                active
                  ? "rounded-md border border-accent bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground"
                  : "rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-surface"
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Gear button + popover for adjusting appearance: theme mode (light/dark/system),
 * accent colour palette, and font size. State lives in the SettingsProvider,
 * which persists it and applies it to <html>.
 */
export function SettingsMenu() {
  const { settings, update, reset } = useSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape while open.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Appearance settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-2 text-foreground hover:bg-surface"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Appearance settings"
          className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-border bg-background p-4 shadow-lg"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight">Appearance</h2>
            <button
              type="button"
              onClick={reset}
              className="rounded px-1.5 py-0.5 text-xs text-muted hover:bg-surface hover:text-foreground"
            >
              Reset
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <SegmentedGroup<ThemeMode>
              label="Theme"
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => update({ theme })}
            />

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Accent color</p>
              <div role="group" aria-label="Accent color" className="flex flex-wrap gap-2">
                {PALETTE_OPTIONS.map((opt) => {
                  const active = settings.palette === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={active}
                      title={opt.label}
                      onClick={() => update({ palette: opt.value as Palette })}
                      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors ${
                        active ? "border-foreground" : "border-transparent hover:border-border"
                      }`}
                    >
                      <span
                        className="h-5 w-5 rounded-full"
                        style={{ backgroundColor: opt.swatch }}
                      />
                      <span className="sr-only">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <SegmentedGroup<FontSize>
              label="Font size"
              value={settings.fontSize}
              options={FONT_SIZE_OPTIONS}
              onChange={(fontSize) => update({ fontSize })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
