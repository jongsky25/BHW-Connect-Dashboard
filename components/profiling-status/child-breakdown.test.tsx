import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { ChildBreakdown } from "@/components/profiling-status/child-breakdown";
import type { ProfilingStatusChild } from "@/lib/db/profiling-status";

/**
 * The five stage columns are a partition — Total = Encoded + Validated + Attested + Not encoded —
 * and the section caption says so ("stages sum to 100%"). PR #67 proposed dropping "Not encoded"
 * as a redundant inverse of a column that no longer exists; #70's rebuild made it a member of the
 * partition instead. These assertions exist so that idea fails loudly rather than quietly
 * falsifying the caption.
 */
const EXPECTED_COLUMNS = ["Area", "Total", "Encoded", "Validated", "Attested", "Not encoded"];

function stage(count: number, pct: number | null, fraction = count / 100) {
  return { count, pct, fraction };
}

const CHILD: ProfilingStatusChild = {
  geoName: "Ilocos Norte",
  geoCode: "0102800000",
  geoLevel: "province",
  totalBhw: 100,
  nRegistered: 60,
  nAccredited: 30,
  nUnregistered: 10,
  nDrafted: 10,
  nForValidation: 5,
  nBackToEncoder: 5,
  nValidated: 20,
  nApproved: 40,
  encoded: stage(20, 20),
  validated: stage(20, 20),
  attested: stage(40, 40),
  notEncoded: stage(20, 20),
  toAttest: { count: 60, pct: 60 },
};

function render(items: ProfilingStatusChild[] = [CHILD]) {
  const { document } = parseHTML(
    `<html><body>${renderToStaticMarkup(
      <ChildBreakdown heading="Provinces" items={items} />,
    )}</body></html>`,
  );
  return document;
}

describe("ChildBreakdown", () => {
  it("renders the full five-stage column set, in order", () => {
    const headers = [...render().querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(headers).toEqual(EXPECTED_COLUMNS);
  });

  it("gives every body row one cell per column", () => {
    const doc = render();
    const cells = doc.querySelectorAll("tbody tr td");
    expect(doc.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(cells).toHaveLength(EXPECTED_COLUMNS.length);
  });

  it("keeps the 'Not encoded' column — it is a member of the partition, not an inverse", () => {
    const doc = render();
    const headers = [...doc.querySelectorAll("thead th")].map((th) => th.textContent?.trim());
    expect(headers).toContain("Not encoded");
    // The four stages it belongs to must all still be rendered alongside the denominator.
    for (const stageName of ["Total", "Encoded", "Validated", "Attested", "Not encoded"]) {
      expect(headers).toContain(stageName);
    }
  });

  it("still captions the table as a partition, matching the columns above", () => {
    expect(render().body.textContent).toContain("stages sum to 100%");
  });

  it("renders each stage's count and percent", () => {
    const text = render().querySelector("tbody tr")?.textContent ?? "";
    expect(text).toContain("Ilocos Norte");
    // encoded / validated / attested / notEncoded all render as "count · pct%".
    expect(text).toContain("40 · 40%");
    expect(text).toContain("20 · 20%");
  });

  it("uses the larger type scale on the heading, header row and body", () => {
    const doc = render();
    expect(doc.querySelector("h2")?.getAttribute("class")).toContain("text-base");
    expect(doc.querySelector("table")?.getAttribute("class")).toContain("text-base");
    expect(doc.querySelector("thead tr")?.getAttribute("class")).toContain("text-sm");
  });

  it("renders nothing when there are no children", () => {
    expect(render([]).body.textContent?.trim()).toBe("");
  });
});
