"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_SETTINGS, STORAGE_KEY, normalizeSettings, type Settings } from "./settings-types";

interface SettingsContextValue {
  settings: Settings;
  /** Merge a partial update, persist it, and apply it to <html>. */
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function resolveTheme(theme: Settings["theme"]): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Stamp the settings onto <html> so globals.css picks them up. */
function applyToDocument(settings: Settings) {
  const d = document.documentElement;
  d.dataset.theme = resolveTheme(settings.theme);
  d.dataset.palette = settings.palette;
  d.dataset.fontSize = settings.fontSize;
}

/**
 * Holds the user's appearance settings, persists them to localStorage, and
 * mirrors them onto the document element. The no-flash script has already
 * applied the stored values before hydration, so we start from DEFAULT_SETTINGS
 * on the server. On the client we seed state straight from storage via a lazy
 * initializer; this is safe because no settings-dependent markup is rendered
 * during hydration (the menu panel is closed), so there is nothing to mismatch.
 */
function readStoredSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    // Corrupt/unavailable storage — keep defaults.
    return DEFAULT_SETTINGS;
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readStoredSettings);

  // Persist + apply on every change (and once on mount, harmlessly reasserting
  // what the no-flash script already put on <html>).
  useEffect(() => {
    applyToDocument(settings);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Storage may be unavailable (private mode) — settings still apply live.
    }
  }, [settings]);

  // Track OS preference changes while the theme is set to "system".
  useEffect(() => {
    if (settings.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyToDocument(settings);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => setSettings(DEFAULT_SETTINGS), []);

  return (
    <SettingsContext.Provider value={{ settings, update, reset }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
