import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A per-table chainable query-builder stub. Unlike `ask-bank.test.ts`'s single builder, the ledger
 * read fans out across four tables in one call (`district_correction`, `geo_district_map`,
 * `dim_legislative_district`, `dim_geo`), and the thing under test is precisely how their results
 * are joined — a stub that returned the same rows to every table would pass whether the join
 * worked or not.
 *
 * It also records every `.select()` it is asked for, which is what lets the privacy test assert a
 * negative: that no query behind the public page ever *requests* `submitter_email`, rather than
 * only that the mapped result happens not to expose it.
 */
type CorrectionRow = {
  id: number;
  created_at: string;
  action: string;
  district_code: string | null;
  to_district_code: string | null;
  geo_code: string | null;
  rationale: string;
  evidence_url: string | null;
  status: string;
  reviewed_at: string | null;
  review_note: string | null;
  submitter_email?: string | null;
  reviewed_by?: string | null;
};

type MapRow = { id: number; district_code: string; geo_code: string; source_ref: string | null };

const { state, createSupabaseServiceClient } = vi.hoisted(() => {
  const state = {
    corrections: [] as Record<string, unknown>[],
    correctionsError: null as { message: string } | null,
    counts: {} as Record<string, number>,
    mapRows: [] as Record<string, unknown>[],
    districts: [] as { district_code: string; district_name: string }[],
    geos: [] as { geo_code: string; geo_name: string }[],
    selects: [] as { table: string; columns: string }[],
    inFilters: [] as { table: string; column: string; values: unknown[] }[],
  };

  function makeBuilder(table: string) {
    let head = false;
    let statusEq: string | null = null;
    let statusNeq: string | null = null;
    let inFilter: { column: string; values: unknown[] } | null = null;

    const result = () => {
      if (table === "district_correction") {
        if (head) return { count: state.counts[statusEq ?? ""] ?? 0, error: null };
        if (state.correctionsError) return { data: null, error: state.correctionsError };
        // Status filters are applied for real, not swallowed: the ledger's promise is that it
        // shows *every* proposal, so a `.eq`/`.neq` sneaking onto the list query is exactly the
        // regression these tests exist to catch, and a no-op stub would hide it.
        return {
          data: state.corrections.filter(
            (row) =>
              (statusEq === null || row.status === statusEq) &&
              (statusNeq === null || row.status !== statusNeq),
          ),
          error: null,
        };
      }
      if (table === "geo_district_map") {
        const refs = new Set((inFilter?.values ?? []) as unknown[]);
        return { data: state.mapRows.filter((r) => refs.has(r.source_ref)), error: null };
      }
      if (table === "dim_legislative_district") {
        const codes = new Set((inFilter?.values ?? []) as unknown[]);
        return { data: state.districts.filter((d) => codes.has(d.district_code)), error: null };
      }
      if (table === "dim_geo") {
        const codes = new Set((inFilter?.values ?? []) as unknown[]);
        return { data: state.geos.filter((g) => codes.has(g.geo_code)), error: null };
      }
      return { data: [], error: null };
    };

    const builder: Record<string, unknown> = {
      select(columns: string, options?: { head?: boolean }) {
        state.selects.push({ table, columns });
        if (options?.head) head = true;
        return builder;
      },
      eq(column: string, value: string) {
        if (column === "status") statusEq = value;
        return builder;
      },
      in(column: string, values: unknown[]) {
        inFilter = { column, values };
        state.inFilters.push({ table, column, values });
        return builder;
      },
      neq(column: string, value: string) {
        if (column === "status") statusNeq = value;
        return builder;
      },
      is: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (value: unknown) => unknown) => resolve(result()),
    };
    return builder;
  }

  const createSupabaseServiceClient = vi.fn(() => ({ from: (table: string) => makeBuilder(table) }));
  return { state, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const {
  PUBLIC_CORRECTION_COLUMNS,
  getPublicDistrictCorrectionLedger,
  isDistrictCorrectionDecision,
} = await import("./district-corrections");

function correction(overrides: Partial<CorrectionRow> = {}): CorrectionRow {
  return {
    id: 1,
    created_at: "2026-09-04T00:00:00Z",
    action: "add",
    district_code: "D-0722-01",
    to_district_code: null,
    geo_code: "072217000",
    rationale: "Barangay Poblacion votes in the 1st District.",
    evidence_url: null,
    status: "open",
    reviewed_at: null,
    review_note: null,
    ...overrides,
  };
}

function mapRow(overrides: Partial<MapRow> = {}): MapRow {
  return {
    id: 900,
    district_code: "D-0722-01",
    geo_code: "072217000",
    source_ref: "district_correction:1",
    ...overrides,
  };
}

beforeEach(() => {
  state.corrections = [];
  state.correctionsError = null;
  state.counts = { open: 0, accepted: 0, rejected: 0, duplicate: 0 };
  state.mapRows = [];
  state.districts = [
    { district_code: "D-0722-01", district_name: "Cebu 1st District" },
    { district_code: "D-0722-02", district_name: "Cebu 2nd District" },
  ];
  state.geos = [{ geo_code: "072217000", geo_name: "Poblacion" }];
  state.selects = [];
  state.inFilters = [];
  createSupabaseServiceClient.mockClear();
});

describe("isDistrictCorrectionDecision", () => {
  it("accepts only the three outcomes a reviewer can record", () => {
    expect(isDistrictCorrectionDecision("accepted")).toBe(true);
    expect(isDistrictCorrectionDecision("rejected")).toBe(true);
    expect(isDistrictCorrectionDecision("duplicate")).toBe(true);
  });

  it("rejects 'open' — where a proposal starts, never something a reviewer submits", () => {
    expect(isDistrictCorrectionDecision("open")).toBe(false);
    expect(isDistrictCorrectionDecision("")).toBe(false);
    expect(isDistrictCorrectionDecision(undefined)).toBe(false);
    expect(isDistrictCorrectionDecision(null)).toBe(false);
  });
});

/**
 * The privacy constraint the migration handed D2.5 (20260902030000_legislative_districts.sql):
 * `district_correction` has no public SELECT policy because `submitter_email` sits on the table,
 * and the ledger is only safe because it projects columns server-side. These assert that
 * projection, since nothing else in the stack does — the service client bypasses RLS, so a column
 * added to this list would be published with no policy left to stop it.
 */
describe("PUBLIC_CORRECTION_COLUMNS", () => {
  it("never names the submitter's email, the reviewer's identity, or the session handle", () => {
    expect(PUBLIC_CORRECTION_COLUMNS).not.toContain("submitter_email");
    expect(PUBLIC_CORRECTION_COLUMNS).not.toContain("reviewed_by");
    expect(PUBLIC_CORRECTION_COLUMNS).not.toContain("session_id");
  });

  it("carries what the ledger has to render — the proposal, its status, and its review note", () => {
    for (const column of [
      "id",
      "created_at",
      "action",
      "district_code",
      "to_district_code",
      "geo_code",
      "rationale",
      "evidence_url",
      "status",
      "reviewed_at",
      "review_note",
    ]) {
      expect(PUBLIC_CORRECTION_COLUMNS).toContain(column);
    }
  });
});

describe("getPublicDistrictCorrectionLedger", () => {
  it("asks the database only for publishable columns", async () => {
    state.corrections = [correction()];
    await getPublicDistrictCorrectionLedger();

    const correctionSelects = state.selects.filter((s) => s.table === "district_correction");
    expect(correctionSelects.length).toBeGreaterThan(0);
    for (const select of correctionSelects) {
      expect(select.columns).not.toContain("submitter_email");
      expect(select.columns).not.toContain("reviewed_by");
    }
  });

  it("publishes unreviewed proposals as 'open' rather than hiding them", async () => {
    state.corrections = [correction({ id: 7, status: "open" })];
    state.counts = { open: 1, accepted: 0, rejected: 0, duplicate: 0 };

    const ledger = await getPublicDistrictCorrectionLedger();
    expect(ledger.corrections).toHaveLength(1);
    expect(ledger.corrections[0].status).toBe("open");
    expect(ledger.corrections[0].reviewNote).toBeNull();
    expect(ledger.counts.pending).toBe(1);
  });

  it("resolves district and place names for the proposal, including a move's destination", async () => {
    state.corrections = [
      correction({ id: 3, action: "move", to_district_code: "D-0722-02", status: "rejected", review_note: "Not what the source says." }),
    ];

    const [row] = (await getPublicDistrictCorrectionLedger()).corrections;
    expect(row.districtName).toBe("Cebu 1st District");
    expect(row.toDistrictName).toBe("Cebu 2nd District");
    expect(row.geoName).toBe("Poblacion");
    expect(row.reviewNote).toBe("Not what the source says.");
  });

  it("links an accepted proposal to the mapping row it wrote, matched on source_ref", async () => {
    // Two accepted proposals, two outcome rows: the pairing has to come from `source_ref`, not
    // from the order the rows came back in.
    state.corrections = [
      correction({ id: 1, status: "accepted", review_note: "Confirmed against RA 11951." }),
      correction({ id: 2, status: "accepted", review_note: "Confirmed too." }),
      correction({ id: 3, status: "rejected", review_note: "Already correct." }),
    ];
    state.mapRows = [
      mapRow({ id: 901, source_ref: "district_correction:2" }),
      mapRow({ id: 900, source_ref: "district_correction:1" }),
    ];

    const { corrections } = await getPublicDistrictCorrectionLedger();
    const first = corrections.find((c) => c.id === 1)!;
    expect(first.outcomeRows).toHaveLength(1);
    expect(first.outcomeRows[0]).toMatchObject({
      id: 900,
      districtCode: "D-0722-01",
      districtName: "Cebu 1st District",
      geoName: "Poblacion",
    });
    expect(corrections.find((c) => c.id === 2)!.outcomeRows.map((o) => o.id)).toEqual([901]);
    // A rejected proposal wrote nothing, so there is nothing to link.
    expect(corrections.find((c) => c.id === 3)!.outcomeRows).toEqual([]);
  });

  it("names an outcome row's district even when the proposal itself never named it", async () => {
    // `source_ref` is the only link between the two tables, so an outcome row is free to land in a
    // district the proposal's own columns don't mention. Resolving names over the proposals alone
    // would render this as a bare code.
    state.corrections = [correction({ id: 1, status: "accepted" })];
    state.mapRows = [mapRow({ id: 900, district_code: "D-0999-09", source_ref: "district_correction:1" })];
    state.districts.push({ district_code: "D-0999-09", district_name: "Camiguin Lone District" });

    const [row] = (await getPublicDistrictCorrectionLedger()).corrections;
    expect(row.outcomeRows[0].districtName).toBe("Camiguin Lone District");
  });

  it("looks for outcome rows only for accepted proposals", async () => {
    state.corrections = [
      correction({ id: 1, status: "accepted" }),
      correction({ id: 2, status: "open" }),
      correction({ id: 3, status: "duplicate" }),
    ];

    await getPublicDistrictCorrectionLedger();
    const lookup = state.inFilters.find((f) => f.table === "geo_district_map");
    expect(lookup?.values).toEqual(["district_correction:1"]);
  });

  it("skips the outcome lookup entirely when nothing has been accepted", async () => {
    state.corrections = [correction({ id: 2, status: "open" })];

    await getPublicDistrictCorrectionLedger();
    expect(state.inFilters.some((f) => f.table === "geo_district_map")).toBe(false);
  });

  it("exposes no submitter email or reviewer identity on the rows it returns", async () => {
    // The row the database hands back carries both columns; only the projection keeps them out.
    state.corrections = [
      correction({ id: 1, status: "accepted", submitter_email: "nurse@example.com", reviewed_by: "admin@example.com" }),
    ];

    const [row] = (await getPublicDistrictCorrectionLedger()).corrections;
    expect(Object.keys(row)).not.toContain("submitterEmail");
    expect(Object.keys(row)).not.toContain("reviewedBy");
    expect(JSON.stringify(row)).not.toContain("nurse@example.com");
    expect(JSON.stringify(row)).not.toContain("admin@example.com");
  });

  it("flags a truncated list, so the page never claims a prefix is the whole ledger", async () => {
    state.corrections = [correction({ id: 1 })];
    state.counts = { open: 1, accepted: 2, rejected: 0, duplicate: 0 };

    const ledger = await getPublicDistrictCorrectionLedger();
    expect(ledger.truncated).toBe(true);

    state.counts = { open: 1, accepted: 0, rejected: 0, duplicate: 0 };
    expect((await getPublicDistrictCorrectionLedger()).truncated).toBe(false);
  });

  it("degrades to an empty ledger rather than throwing when the read fails", async () => {
    state.correctionsError = { message: "boom" };
    state.counts = { open: 4, accepted: 0, rejected: 0, duplicate: 0 };

    const ledger = await getPublicDistrictCorrectionLedger();
    expect(ledger.corrections).toEqual([]);
    // The counts are their own query and survive the list's failure, so the page still says how
    // many proposals exist rather than implying there are none.
    expect(ledger.counts.pending).toBe(4);
  });
});
