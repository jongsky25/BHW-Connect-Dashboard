/**
 * Shared types + constants for the user appearance settings (theme mode, accent
 * palette, font size). Kept framework-free so both the no-flash inline script
 * and the React provider can rely on the same option lists.
 */

export type ThemeMode = "light" | "dark" | "system";
export type Palette = "teal" | "blue" | "violet" | "rose" | "amber";
export type FontSize = "sm" | "base" | "lg" | "xl";

export interface Settings {
  theme: ThemeMode;
  palette: Palette;
  fontSize: FontSize;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  palette: "teal",
  fontSize: "base",
};

/** localStorage key holding the JSON-serialised {@link Settings}. */
export const STORAGE_KEY = "bhw-settings";

export const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export const PALETTE_OPTIONS: { value: Palette; label: string; swatch: string }[] = [
  { value: "teal", label: "Teal", swatch: "#0a6e6e" },
  { value: "blue", label: "Blue", swatch: "#1d4ed8" },
  { value: "violet", label: "Violet", swatch: "#6d28d9" },
  { value: "rose", label: "Rose", swatch: "#be123c" },
  { value: "amber", label: "Amber", swatch: "#9a6700" },
];

export const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "base", label: "Default" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "X-Large" },
];

/** Coerce arbitrary parsed JSON into a valid {@link Settings}, dropping unknowns. */
export function normalizeSettings(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Record<keyof Settings, string>>;
  const themes = THEME_OPTIONS.map((o) => o.value) as string[];
  const palettes = PALETTE_OPTIONS.map((o) => o.value) as string[];
  const sizes = FONT_SIZE_OPTIONS.map((o) => o.value) as string[];
  return {
    theme: themes.includes(value.theme ?? "") ? (value.theme as ThemeMode) : DEFAULT_SETTINGS.theme,
    palette: palettes.includes(value.palette ?? "")
      ? (value.palette as Palette)
      : DEFAULT_SETTINGS.palette,
    fontSize: sizes.includes(value.fontSize ?? "")
      ? (value.fontSize as FontSize)
      : DEFAULT_SETTINGS.fontSize,
  };
}
