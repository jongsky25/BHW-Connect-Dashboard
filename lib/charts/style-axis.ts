/**
 * Post-render styling for Observable Plot charts. Two jobs:
 *
 *  1. Weight/enlarge the x- and y-axis *title* text (Plot exposes no spec option
 *     to style the axis label specifically — its font options apply to tick
 *     labels only), so we set the attributes directly on the rendered <text>.
 *  2. Force every text node to `fill: currentColor`. Plot's default text fill is
 *     a fixed near-black that ignores our `data-theme` dark mode, so an enlarged
 *     chart rendered black-on-dark was unreadable (user feedback #10). Inheriting
 *     `currentColor` lets the text follow the container's themed CSS `color`
 *     (`text-foreground` on the client; an explicit dark color on the white PNG
 *     export card).
 *
 * Called after `Plot.plot()` on every render path — the client charts and the
 * server-side PNG export — so the on-screen chart and the exported image stay
 * identical. Works on both the browser DOM and linkedom since both implement
 * querySelectorAll/setAttribute.
 */
export function styleAxisTitles(root: ParentNode): void {
  // Theme-aware text everywhere: ticks, value labels, titles, tooltips.
  for (const el of Array.from(root.querySelectorAll("text"))) {
    el.setAttribute("fill", "currentColor");
  }

  // Axis titles get extra weight/size so they read clearly against tick labels.
  for (const selector of ['[aria-label="y-axis label"] text', '[aria-label="x-axis label"] text']) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      el.setAttribute("font-weight", "600");
      el.setAttribute("font-size", "13");
    }
  }
}
