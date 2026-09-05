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
    /** The judge path (D2.4/D2.6), which reads and writes single rows rather than lists. */
    correctionRow: null as Record<string, unknown> | null,
    liveMember: null as Record<string, unknown> | null,
    geoLevel: "barangay" as string | null,
    inserts: [] as { table: string; row: Record<string, unknown> }[],
    writes: [] as { table: string; row: Record<string, unknown> }[],
    writeError: null as { message: string } | null,
  };

  function makeBuilder(table: string) {
    let head = false;
    let statusEq: string | null = null;
    let statusNeq: string | null = null;
    let inFilter: { column: string; values: unknown[] } | null = null;
    let writing = false;
    let pendingWrite: Record<string, unknown> | null = null;
    const eqs: Record<string, string> = {};

    const result = () => {
      // A write returns rows it touched, not the table's contents. `state.writeError` is how a
      // failed status update is tested without disturbing any read.
      if (writing) {
        // An accepted rename really does overwrite `dim_legislative_district.district_name`, and
        // the stub has to model that or the ordering it forces is untestable: a lookup that always
        // returns the old name passes whether it ran before the write or after it.
        if (table === "dim_legislative_district" && typeof pendingWrite?.district_name === "string") {
          const target = state.districts.find((d) => d.district_code === eqs.district_code);
          if (target) target.district_name = pendingWrite.district_name as string;
        }
        return { data: [{ id: 1 }], error: state.writeError };
      }
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
        eqs[column] = value;
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
      update(row: Record<string, unknown>) {
        writing = true;
        pendingWrite = row;
        state.writes.push({ table, row });
        return builder;
      },
      insert(row: Record<string, unknown>) {
        writing = true;
        state.inserts.push({ table, row });
        return builder;
      },
      maybeSingle() {
        if (table === "district_correction") return Promise.resolve({ data: state.correctionRow, error: null });
        if (table === "geo_district_map") return Promise.resolve({ data: state.liveMember, error: null });
        if (table === "dim_geo") {
          return Promise.resolve({ data: state.geoLevel ? { geo_level: state.geoLevel } : null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      single: () => Promise.resolve({ data: { id: 900 }, error: state.writeError }),
      then: (resolve: (value: unknown) => unknown) => resolve(result()),
    };
    return builder;
  }

  const createSupabaseServiceClient = vi.fn(() => ({ from: (table: string) => makeBuilder(table) }));
  return { state, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const publishAcceptedCorrection = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/lib/db/district-correction-changelog", () => ({ publishAcceptedCorrection }));

const {
  PUBLIC_CORRECTION_COLUMNS,
  getPublicDistrictCorrectionLedger,
  isDistrictCorrectionDecision,
  judgeDistrictCorrection,
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
  state.correctionRow = null;
  state.liveMember = null;
  state.geoLevel = "barangay";
  state.inserts = [];
  state.writes = [];
  state.writeError = null;
  createSupabaseServiceClient.mockClear();
  publishAcceptedCorrection.mockClear();
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

/**
 * D2.6 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5): an accepted correction does not stop at the
 * mapping row. It also records itself on the changelog and moves the district dataset's version.
 *
 * These assert the *wiring* — that publication happens on acceptance and only on acceptance, with
 * the names the changelog needs — while `district-correction-changelog.test.ts` asserts what the
 * two writes actually say. Splitting them that way is what lets the rename case be tested at all:
 * the thing worth asserting there is which name reaches the changelog, and that is decided here,
 * by reading the district's name before `applyAcceptance` overwrites it.
 */
describe("judgeDistrictCorrection — publication (D2.6)", () => {
  function open(overrides: Record<string, unknown> = {}) {
    return {
      id: 12,
      created_at: "2026-09-04T00:00:00Z",
      action: "add",
      district_code: "D-0722-01",
      to_district_code: null,
      geo_code: "072217000",
      rationale: "Barangay Poblacion votes in the 1st District.",
      evidence_url: null,
      submitter_email: "nurse@example.com",
      status: "open",
      ...overrides,
    };
  }

  it("publishes an accepted correction, with the place and district resolved to names", async () => {
    state.correctionRow = open();

    expect(await judgeDistrictCorrection(12, "accepted", "admin@example.gov.ph", "Confirmed", null)).toBeNull();
    expect(publishAcceptedCorrection).toHaveBeenCalledWith({
      id: 12,
      action: "add",
      districtCode: "D-0722-01",
      districtName: "Cebu 1st District",
      toDistrictCode: null,
      toDistrictName: null,
      geoCode: "072217000",
      geoName: "Poblacion",
      newDistrictName: null,
    });
  });

  it("hands the changelog no submitter email or reviewer identity", async () => {
    // The row read here carries both. Only the projection into the published summary keeps them
    // out, the same shape D2.5's ledger uses.
    state.correctionRow = open();
    await judgeDistrictCorrection(12, "accepted", "admin@example.gov.ph", "Confirmed", null);
    expect(JSON.stringify(publishAcceptedCorrection.mock.calls[0])).not.toContain("@");
  });

  it("publishes nothing for a rejection or a duplicate", async () => {
    // Neither changed the mapping, so there is no data change to record and nothing whose cached
    // answers would be stale. The ledger still shows the outcome; the changelog is for changes.
    for (const decision of ["rejected", "duplicate"] as const) {
      state.correctionRow = open();
      await judgeDistrictCorrection(12, decision, "admin@example.gov.ph", "Not supported", null);
    }
    expect(publishAcceptedCorrection).not.toHaveBeenCalled();
  });

  it("carries a rename's old name, read before the acceptance overwrote it", async () => {
    // `applyAcceptance` updates `dim_legislative_district.district_name` in place. Looking the name
    // up afterwards would print the new name on both sides — "Rename Cebu 1st Legislative District"
    // for a district that was called something else a moment earlier.
    state.correctionRow = open({ action: "rename" });

    await judgeDistrictCorrection(12, "accepted", "admin@example.gov.ph", "Typo", "Cebu 1st Legislative District");
    expect(publishAcceptedCorrection).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rename",
        districtName: "Cebu 1st District",
        newDistrictName: "Cebu 1st Legislative District",
      }),
    );
  });

  it("publishes nothing when the mapping write failed", async () => {
    // A failed accept leaves the proposal open for the admin to retry. A changelog entry for it
    // would announce a change that did not happen.
    state.correctionRow = open();
    state.geoLevel = null; // the place resolves to neither a citymun nor a barangay

    expect(await judgeDistrictCorrection(12, "accepted", "admin@example.gov.ph", "Confirmed", null)).toBeTruthy();
    expect(publishAcceptedCorrection).not.toHaveBeenCalled();
  });

  it("publishes nothing when the proposal could not be closed", async () => {
    // `other` so the only write in play is the status update — an action with a mapping mutation
    // would fail earlier and this would pass for the wrong reason.
    state.correctionRow = open({ action: "other" });
    state.writeError = { message: "update failed" };

    expect(await judgeDistrictCorrection(12, "accepted", "admin@example.gov.ph", "Confirmed", null)).toBe(
      "update failed",
    );
    expect(publishAcceptedCorrection).not.toHaveBeenCalled();
  });

  it("refuses to re-judge a correction that was already judged", async () => {
    state.correctionRow = open({ status: "accepted" });
    expect(await judgeDistrictCorrection(12, "accepted", "admin@example.gov.ph", "Again", null)).toBe(
      "This correction has already been judged",
    );
    expect(publishAcceptedCorrection).not.toHaveBeenCalled();
  });
});
