import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PORTAL_CRUMB, trailForPathname } from "./breadcrumbs";

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

/** Every route in `app/` that renders a page, as the pathname a visitor sees. */
function routes(dir = APP_DIR, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") found.push(prefix || "/");
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    // Route groups — "(dashboard)" — organise files without adding a segment.
    const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
    found.push(...routes(`${dir}/${entry.name}`, `${prefix}${segment}`));
  }
  return found;
}

const isDynamic = (route: string) => route.includes("[");

describe("trailForPathname", () => {
  it("finds every page in app/ (guards the walk itself)", () => {
    const all = routes();
    expect(all).toContain("/bhw");
    expect(all).toContain("/uuc-phc/methodology");
    expect(all).toContain("/admin/ai-quota");
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(routes().filter((r) => r !== "/" && !isDynamic(r)))(
    "gives %s a trail rooted at the portal",
    (route) => {
      const trail = trailForPathname(route);
      expect(trail, `no breadcrumb trail registered for ${route}`).not.toBeNull();
      expect(trail![0]).toEqual(PORTAL_CRUMB);
      // The last crumb is the page itself. A section root reuses its own linked
      // crumb there (`Breadcrumbs` drops the link on the last one), so its href
      // — when there is one — has to point at this very route.
      const last = trail![trail!.length - 1];
      expect(last.href ?? route).toBe(route);
    },
  );

  it("leaves the portal itself without a trail — it is where every trail points", () => {
    expect(trailForPathname("/")).toBeNull();
  });

  it("defers geo-named routes to the page, which resolves the names", () => {
    expect(trailForPathname("/place/region/PH-07")).toBeNull();
    expect(trailForPathname("/uuc-phc/citymun/072217000")).toBeNull();
    expect(trailForPathname("/profiling-status/region/PH-07")).toBeNull();
  });

  it("labels the admin source viewer without needing the chunk id", () => {
    const trail = trailForPathname("/admin/assistant/source/abc-123");
    expect(trail?.map((c) => c.label)).toEqual([
      "Equity in Health",
      "2025 BHW Census",
      "Admin",
      "Assistant",
      "Source",
    ]);
  });

  it("tolerates a trailing slash", () => {
    expect(trailForPathname("/explore/")).toEqual(trailForPathname("/explore"));
  });
});
