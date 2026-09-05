import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D2.6 (docs/LEGISLATIVE_DISTRICTS_PLAN.md §5): what an accepted correction publishes about itself.
 *
 * The stub covers both writes through one service client — the changelog insert and the
 * `dim_dataset` bump — rather than mocking `bumpDatasetVersion` away, because the thing most worth
 * asserting about the bump is the one a mock would supply for free: that it names
 * `ph-legislative-districts` and nothing else. A correction to the district mapping that bumped
 * `bhw-2025` would expire every BHW answer on the site and leave the district ones stale, in both
 * directions at once, and nothing downstream would report it.
 */

const { state, createSupabaseServiceClient } = vi.hoisted(() => {
  const state = {
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    insertError: null as { message: string } | null,
    updates: [] as { table: string; row: Record<string, unknown>; slug: string | null }[],
    updateError: null as { message: string } | null,
    updatedRows: [{ dataset_id: 42 }] as { dataset_id: number }[],
    throwOn: null as string | null,
  };

  function makeBuilder(table: string) {
    let slug: string | null = null;
    const builder: Record<string, unknown> = {
      insert(row: Record<string, unknown>) {
        if (state.throwOn === table) throw new Error("client exploded");
        state.inserted.push({ table, row });
        return { then: (resolve: (v: unknown) => unknown) => resolve({ error: state.insertError }) };
      },
      update(row: Record<string, unknown>) {
        if (state.throwOn === table) throw new Error("client exploded");
        state.updates.push({ table, row, slug: null });
        return builder;
      },
      eq(column: string, value: string) {
        if (column === "slug") {
          slug = value;
          const last = state.updates.at(-1);
          if (last) last.slug = value;
        }
        return builder;
      },
      select() {
        return {
          then: (resolve: (v: unknown) => unknown) =>
            resolve(
              state.updateError
                ? { data: null, error: state.updateError }
                : { data: slug === "ph-legislative-districts" ? state.updatedRows : [], error: null },
            ),
        };
      },
    };
    return builder;
  }

  const createSupabaseServiceClient = vi.fn(() => ({ from: (table: string) => makeBuilder(table) }));
  return { state, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { draftAcceptedCorrectionChangelog, publishAcceptedCorrection } = await import(
  "./district-correction-changelog"
);

type Accepted = Parameters<typeof publishAcceptedCorrection>[0];

function accepted(overrides: Partial<Accepted> = {}): Accepted {
  return {
    id: 12,
    action: "move",
    districtCode: "D-0722-01",
    districtName: "Cebu 1st District",
    toDistrictCode: "D-0722-02",
    toDistrictName: "Cebu 2nd District",
    geoCode: "072217000",
    geoName: "Poblacion",
    newDistrictName: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.inserted = [];
  state.insertError = null;
  state.updates = [];
  state.updateError = null;
  state.updatedRows = [{ dataset_id: 42 }];
  state.throwOn = null;
  createSupabaseServiceClient.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("draftAcceptedCorrectionChangelog", () => {
  it("reuses the queue and ledger's one-line description rather than paraphrasing it", () => {
    // docs/DECISIONS.md, 2026-09-05: the admin queue and the public ledger deliberately share
    // `describeCorrectionChange`. A reader who follows a changelog line to the ledger should meet
    // the same sentence, so the changelog is the third caller of it, not a third wording.
    const { title } = draftAcceptedCorrectionChangelog(accepted());
    expect(title).toBe("Legislative districts: Move Poblacion from Cebu 1st District to Cebu 2nd District");
  });

  it("names the dataset in the title, because the changelog is site-wide", () => {
    // `/methodology`'s changelog carries entries about every dataset on the site. An entry reading
    // only "Add Poblacion to Cebu 1st District" would not say which of them moved.
    for (const action of ["add", "remove", "move", "rename", "other"] as const) {
      const { title } = draftAcceptedCorrectionChangelog(accepted({ action }));
      expect(title, action).toMatch(/^Legislative districts: /);
    }
  });

  it("says what an acceptance did to the mapping, including where it left no row to link", () => {
    // Two of the five actions write no `geo_district_map` row at all. Without this the entry reads
    // as "accepted, and nothing visibly happened".
    expect(draftAcceptedCorrectionChangelog(accepted({ action: "remove" })).bodyMd).toMatch(
      /withdrawn from the mapping/i,
    );
    expect(draftAcceptedCorrectionChangelog(accepted({ action: "other" })).bodyMd).toMatch(
      /No automatic change was applied/i,
    );
  });

  it("prints the new name on a rename, which the shared description does not carry", () => {
    const { title, bodyMd } = draftAcceptedCorrectionChangelog(
      accepted({ action: "rename", newDistrictName: "Cebu 1st Legislative District" }),
    );
    expect(title).toBe("Legislative districts: Rename Cebu 1st District");
    expect(bodyMd).toContain('now named "Cebu 1st Legislative District"');
  });

  it("omits the rename clause when no new name was recorded", () => {
    expect(draftAcceptedCorrectionChangelog(accepted({ action: "rename" })).bodyMd).not.toMatch(
      /now named/,
    );
    // And never prints one on an action that has no name to print.
    expect(
      draftAcceptedCorrectionChangelog(accepted({ action: "add", newDistrictName: "ignored" })).bodyMd,
    ).not.toMatch(/now named/);
  });

  it("points at the ledger for the reasoning instead of copying the submitter's text", () => {
    // The rationale is public and the ledger publishes it in full. Republishing an open form's
    // output on `/methodology` — a page nobody reviews entry by entry — is a different decision
    // from publishing it on the page about proposals, and this one is not made.
    const { bodyMd } = draftAcceptedCorrectionChangelog(accepted());
    expect(bodyMd).toContain("/districts/corrections");
    expect(bodyMd).toContain("Public correction #12");
  });

  it("repeats that the mapping is not official, on the page that records data changes", () => {
    // Guardrail 6 (plan §7): never present the mapping as official. A changelog entry saying a
    // district's membership changed is precisely where a reader might infer a redistricting.
    const { bodyMd } = draftAcceptedCorrectionChangelog(accepted());
    expect(bodyMd).toMatch(/not published by PSA or COMELEC/);
  });

  it("writes plain prose, because /methodology renders body_md verbatim in a <p>", () => {
    const { bodyMd } = draftAcceptedCorrectionChangelog(accepted());
    expect(bodyMd).not.toMatch(/\[.+\]\(.+\)/); // no markdown links
    expect(bodyMd).not.toMatch(/[*_`]/); // no markdown emphasis or code
    expect(bodyMd).not.toMatch(/(^|\n)#/); // no headings — "#12" is a proposal number, not one
  });
});

describe("publishAcceptedCorrection", () => {
  it("writes one changelog row carrying the drafted title and body", async () => {
    const outcome = await publishAcceptedCorrection(accepted());

    expect(outcome.changelogWritten).toBe(true);
    const rows = state.inserted.filter((i) => i.table === "changelog_entries");
    expect(rows).toHaveLength(1);
    const { title, bodyMd } = draftAcceptedCorrectionChangelog(accepted());
    expect(rows[0].row).toEqual({ title, body_md: bodyMd });
  });

  it("bumps the district dataset's version, and only that dataset's", async () => {
    const outcome = await publishAcceptedCorrection(accepted());

    expect(outcome.versionBumped).toBe(true);
    const bumps = state.updates.filter((u) => u.table === "dim_dataset");
    expect(bumps).toHaveLength(1);
    expect(bumps[0].slug).toBe("ph-legislative-districts");
    expect(Object.keys(bumps[0].row)).toEqual(["last_updated_at"]);
    expect(String(bumps[0].row.last_updated_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("never writes a submitter's email or a reviewer's identity into the changelog", async () => {
    // The changelog is public and the entry is assembled from resolved names, not from the row —
    // this asserts that shape holds rather than trusting it.
    await publishAcceptedCorrection(accepted());
    const serialized = JSON.stringify(state.inserted);
    expect(serialized).not.toMatch(/@/);
  });

  it("still bumps the version when the changelog write fails, and reports both", async () => {
    // The two writes record different things. A failed changelog entry is a missing record; a
    // skipped bump would leave a cache key claiming the mapping had not changed, which is worse.
    state.insertError = { message: "changelog is full" };

    const outcome = await publishAcceptedCorrection(accepted());
    expect(outcome.changelogWritten).toBe(false);
    expect(outcome.versionBumped).toBe(true);
    expect(outcome.failures).toEqual(["changelog entry: changelog is full"]);
  });

  it("reports a bump that matched no row rather than counting it as done", async () => {
    // PostgREST does not treat an update matching nothing as an error. Here it is one: it means
    // no `dim_dataset` row is versioning this mapping at all.
    state.updatedRows = [];

    const outcome = await publishAcceptedCorrection(accepted());
    expect(outcome.versionBumped).toBe(false);
    expect(outcome.failures.join(" ")).toMatch(/No dim_dataset row for slug 'ph-legislative-districts'/);
  });

  it("never throws back at the caller — the mapping write has already happened", async () => {
    // By the time this runs the `geo_district_map` row exists and the proposal is closed. Throwing
    // would fail an acceptance that already succeeded, and the admin's retry re-applies the
    // mutation.
    state.throwOn = "changelog_entries";
    state.updateError = { message: "connection lost" };

    const outcome = await publishAcceptedCorrection(accepted());
    expect(outcome.changelogWritten).toBe(false);
    expect(outcome.versionBumped).toBe(false);
    expect(outcome.failures).toHaveLength(2);
  });
});
