import { DEFAULT_SETTINGS, STORAGE_KEY } from "./settings-types";

/**
 * Inline script injected into <head> so the persisted appearance settings are
 * applied to <html> *before* the first paint — no flash of the wrong theme.
 *
 * It resolves the stored theme (falling back to the OS preference for
 * "system") and stamps data-theme / data-palette / data-font-size onto the
 * root element, which globals.css keys all of its CSS variables off of.
 * Runs before React hydrates; the SettingsProvider keeps it in sync afterward.
 */
export function NoFlashScript() {
  const script = `(function(){try{
var d=document.documentElement;
var def=${JSON.stringify(DEFAULT_SETTINGS)};
var s=def;
try{var raw=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});if(raw){var p=JSON.parse(raw);s={theme:p.theme||def.theme,palette:p.palette||def.palette,fontSize:p.fontSize||def.fontSize};}}catch(e){}
var resolved=s.theme==='system'?(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):s.theme;
d.dataset.theme=resolved;
d.dataset.palette=s.palette;
d.dataset.fontSize=s.fontSize;
}catch(e){}})();`;

  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
