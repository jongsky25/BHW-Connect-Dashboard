import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { CorrectionLedger, filterCorrections } from "@/components/districts/correction-ledger";
import { describeAcceptedOutcome, describeCorrectionChange } from "@/components/districts/correction-change";
import type { PublicDistrictCorrection } from "@/lib/db/district-corrections";

/**
 * D2.5's ledger is the page that makes the correction mechanism credible rather than decorative,
 * and everything that makes it credible is a *rendering* fact: the rejection's reason is on the
 * page, the unreviewed proposal is on the page, the accepted one links to the row it changed. Each
 * of those can be lost by an edit that still typechecks, which is why they are asserted against
 * the rendered markup rather than the props.
 */
function proposal(overrides: Partial<PublicDistrictCorrection> = {}): PublicDistrictCorrection {
  return {
    id: 1,
    createdAt: "2026-09-04T00:00:00Z",
    action: "add",
    districtCode: "D-0722-01",
    districtName: "Cebu 1st District",
    toDistrictCode: null,
    toDistrictName: null,
    geoCode: "072217000",
    geoName: "Poblacion",
    rationale: "Poblacion votes in the 1st District.",
    evidenceUrl: null,
    status: "open",
    reviewedAt: null,
    reviewNote: null,
    outcomeRows: [],
    ...overrides,
  };
}

function render(corrections: PublicDistrictCorrection[]) {
  const { document } = parseHTML(
    `<html><body>${renderToStaticMarkup(<CorrectionLedger corrections={corrections} />)}</body></html>`,
  );
  return document;
}

describe("CorrectionLedger", () => {
  it("publishes a rejection's reason verbatim", () => {
    const note = "The source page's revision 12345 lists Poblacion in the 2nd District.";
    const document = render([proposal({ status: "rejected", reviewedAt: "2026-09-05T00:00:00Z", reviewNote: note })]);

    expect(document.body.textContent).toContain(note);
    expect(document.body.textContent).toContain("Not accepted");
  });

  it("shows a proposal nobody has judged yet, rather than waiting for an outcome to exist", () => {
    const document = render([proposal({ status: "open" })]);

    expect(document.body.textContent).toContain("Awaiting review");
    expect(document.body.textContent).toContain("Poblacion votes in the 1st District.");
    expect(document.body.textContent).toContain("Not yet reviewed");
  });

  it("links an accepted proposal to the mapping row it wrote", () => {
    const document = render([
      proposal({
        status: "accepted",
        reviewedAt: "2026-09-05T00:00:00Z",
        reviewNote: "Confirmed against RA 11951.",
        outcomeRows: [
          {
            id: 900,
            districtCode: "D-0722-01",
            districtName: "Cebu 1st District",
            geoCode: "072217000",
            geoName: "Poblacion",
          },
        ],
      }),
    ]);

    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/districts/D-0722-01");
    expect(document.body.textContent).toContain("the row this wrote");
  });

  it("explains an accepted outcome that leaves no row to link — a remove, a rename", () => {
    // The distinguishing phrase per action, not just `describeAcceptedOutcome(action)`, which would
    // agree with itself if the two explanations were swapped.
    const distinctive = { remove: "no row to link to", rename: "name was corrected" } as const;
    for (const action of ["remove", "rename"] as const) {
      const document = render([
        proposal({ action, status: "accepted", reviewedAt: "2026-09-05T00:00:00Z", reviewNote: "Applied." }),
      ]);
      expect(document.body.textContent).toContain(describeAcceptedOutcome(action));
      expect(document.body.textContent).toContain(distinctive[action]);
      // Still reachable: the district the proposal named, even with no outcome row of its own.
      const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(links).toContain("/districts/D-0722-01");
    }
  });

  it("names both districts of a move without repeating the destination once it has an outcome row", () => {
    const move = proposal({
      action: "move",
      status: "accepted",
      reviewedAt: "2026-09-05T00:00:00Z",
      reviewNote: "Applied.",
      toDistrictCode: "D-0722-02",
      toDistrictName: "Cebu 2nd District",
      outcomeRows: [
        {
          id: 901,
          districtCode: "D-0722-02",
          districtName: "Cebu 2nd District",
          geoCode: "072217000",
          geoName: "Poblacion",
        },
      ],
    });
    const document = render([move]);

    expect(document.body.textContent).toContain(describeCorrectionChange(move));
    const links = [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    // Origin district linked once, destination linked once — as the outcome row, not twice.
    expect(links.filter((href) => href === "/districts/D-0722-02")).toHaveLength(1);
    expect(links).toContain("/districts/D-0722-01");
  });

  it("marks an evidence link untrusted — the URL is whatever a stranger typed", () => {
    const document = render([proposal({ evidenceUrl: "https://example.gov.ph/ra-11951" })]);
    const link = [...document.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "https://example.gov.ph/ra-11951",
    );

    expect(link).toBeDefined();
    expect(link!.getAttribute("rel")).toContain("nofollow");
    expect(link!.getAttribute("rel")).toContain("noopener");
    expect(link!.getAttribute("target")).toBe("_blank");
  });

  it("says how many proposals it is showing, out of how many there are", () => {
    const document = render([proposal({ id: 1 }), proposal({ id: 2, status: "accepted", reviewNote: "Applied." })]);
    expect(document.body.textContent).toContain("Showing 2 of 2 proposals");
  });
});

describe("filterCorrections", () => {
  const rows = [
    proposal({ id: 1, status: "open", rationale: "Poblacion votes in the 1st District." }),
    proposal({
      id: 2,
      status: "rejected",
      geoName: "Talamban",
      rationale: "Talamban is in the wrong district.",
      reviewNote: "The 2025 source page already places it here.",
    }),
    proposal({ id: 3, status: "accepted", districtName: "Bohol 2nd District", reviewNote: "Applied." }),
  ];

  it("returns everything when nothing is asked of it", () => {
    expect(filterCorrections(rows, "all", "").map((r) => r.id)).toEqual([1, 2, 3]);
    expect(filterCorrections(rows, "all", "   ").map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("filters by status, unreviewed proposals included as a status of their own", () => {
    expect(filterCorrections(rows, "open", "").map((r) => r.id)).toEqual([1]);
    expect(filterCorrections(rows, "rejected", "").map((r) => r.id)).toEqual([2]);
    expect(filterCorrections(rows, "accepted", "").map((r) => r.id)).toEqual([3]);
    expect(filterCorrections(rows, "duplicate", "")).toEqual([]);
  });

  it("searches place, district, the submitted wording, and the reviewer's wording", () => {
    expect(filterCorrections(rows, "all", "talamban").map((r) => r.id)).toEqual([2]);
    expect(filterCorrections(rows, "all", "Bohol").map((r) => r.id)).toEqual([3]);
    expect(filterCorrections(rows, "all", "wrong district").map((r) => r.id)).toEqual([2]);
    // The review note is searchable too — how a class of proposal was handled is the question this
    // page is most often asked.
    expect(filterCorrections(rows, "all", "2025 source page").map((r) => r.id)).toEqual([2]);
  });

  it("combines the two filters rather than letting either win", () => {
    expect(filterCorrections(rows, "accepted", "talamban")).toEqual([]);
    expect(filterCorrections(rows, "rejected", "talamban").map((r) => r.id)).toEqual([2]);
  });
});

describe("describeCorrectionChange", () => {
  it("reads as the diff header it is, for each of the five actions", () => {
    const base = proposal({ toDistrictCode: "D-0722-02", toDistrictName: "Cebu 2nd District" });
    expect(describeCorrectionChange({ ...base, action: "add" })).toBe("Add Poblacion to Cebu 1st District");
    expect(describeCorrectionChange({ ...base, action: "remove" })).toBe(
      "Remove Poblacion from Cebu 1st District",
    );
    expect(describeCorrectionChange({ ...base, action: "move" })).toBe(
      "Move Poblacion from Cebu 1st District to Cebu 2nd District",
    );
    expect(describeCorrectionChange({ ...base, action: "rename" })).toBe("Rename Cebu 1st District");
    expect(describeCorrectionChange({ ...base, action: "other" })).toBe(
      "Something else about Cebu 1st District",
    );
  });

  it("falls back to the code, never to a blank, when a name could not be resolved", () => {
    const unresolved = describeCorrectionChange({
      action: "add",
      districtCode: "D-0722-01",
      districtName: null,
      toDistrictCode: null,
      toDistrictName: null,
      geoCode: "072217000",
      geoName: null,
    });
    expect(unresolved).toBe("Add 072217000 to D-0722-01");
  });
});
