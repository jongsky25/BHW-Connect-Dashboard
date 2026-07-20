/**
 * Post-render styling for the x- and y-axis titles. Observable Plot exposes no
 * spec option to weight or enlarge the axis *label* text specifically (its font
 * options apply to the tick labels), so we set the attributes directly on the
 * rendered <text> nodes. Called after `Plot.plot()` on every render path — the
 * client charts and the server-side PNG export — so the on-screen chart and the
 * exported image stay identical. Works on both the browser DOM and linkedom
 * since both implement querySelectorAll/setAttribute.
 */
export function styleAxisTitles(root: ParentNode): void {
  for (const selector of ['[aria-label="y-axis label"] text', '[aria-label="x-axis label"] text']) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      el.setAttribute("font-weight", "600");
      el.setAttribute("font-size", "12");
    }
  }
}
