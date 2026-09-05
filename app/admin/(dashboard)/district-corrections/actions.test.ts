import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  judgeDistrictCorrection: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/require-admin", () => ({ getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/db/district-corrections", () => ({
  judgeDistrictCorrection: mocks.judgeDistrictCorrection,
  isDistrictCorrectionDecision: (v: unknown) =>
    v === "accepted" || v === "rejected" || v === "duplicate",
}));

const { judgeCorrection } = await import("./actions");

const ADMIN = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "staff@example.gov.ph",
  role: "admin" as const,
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getAdminUser.mockResolvedValue(ADMIN);
});

/**
 * D2.4's server action. Same two security properties as `kb-review/actions.ts` (admin re-checked
 * here, reviewer identity taken from the session), plus one this queue adds on top: the plan calls
 * `review_note` mandatory (§5 D2.4), so a blank note refuses the action rather than merely being
 * discouraged by a placeholder.
 */
describe("district corrections actions", () => {
  it("writes nothing when the caller is not an admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    await judgeCorrection(form({ correctionId: "7", decision: "accepted", note: "looks right" }));
    expect(mocks.judgeDistrictCorrection).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("takes the reviewer from the session and ignores one supplied by the form", async () => {
    await judgeCorrection(
      form({
        correctionId: "7",
        decision: "accepted",
        note: "confirmed against the source",
        reviewedBy: "someone.else@example.com",
      }),
    );
    expect(mocks.judgeDistrictCorrection).toHaveBeenCalledWith(
      7,
      "accepted",
      ADMIN.email,
      "confirmed against the source",
      null,
    );
  });

  it("falls back to the admin id when the session carries no email", async () => {
    mocks.getAdminUser.mockResolvedValue({ ...ADMIN, email: null });
    await judgeCorrection(form({ correctionId: "3", decision: "rejected", note: "wrong place" }));
    expect(mocks.judgeDistrictCorrection).toHaveBeenCalledWith(3, "rejected", ADMIN.id, "wrong place", null);
  });

  it("refuses a decision that is not a judgement", async () => {
    await judgeCorrection(form({ correctionId: "7", decision: "open", note: "x" }));
    await judgeCorrection(form({ correctionId: "7", decision: "approved", note: "x" }));
    expect(mocks.judgeDistrictCorrection).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a positive integer", async () => {
    for (const correctionId of ["0", "-4", "abc", "1.5", ""]) {
      await judgeCorrection(form({ correctionId, decision: "accepted", note: "x" }));
    }
    expect(mocks.judgeDistrictCorrection).not.toHaveBeenCalled();
  });

  it("requires a non-blank note for every outcome, including acceptance", async () => {
    await judgeCorrection(form({ correctionId: "7", decision: "accepted", note: "" }));
    await judgeCorrection(form({ correctionId: "7", decision: "accepted", note: "   " }));
    expect(mocks.judgeDistrictCorrection).not.toHaveBeenCalled();

    await judgeCorrection(form({ correctionId: "7", decision: "duplicate", note: "same as #4" }));
    expect(mocks.judgeDistrictCorrection).toHaveBeenCalledWith(7, "duplicate", ADMIN.email, "same as #4", null);
  });

  it("caps the note rather than letting an unbounded string reach the row", async () => {
    await judgeCorrection(
      form({ correctionId: "7", decision: "rejected", note: "x".repeat(900) }),
    );
    expect(mocks.judgeDistrictCorrection.mock.calls[0][3]).toHaveLength(500);
  });

  it("passes a trimmed newDistrictName through for a rename, and null when blank", async () => {
    await judgeCorrection(
      form({
        correctionId: "7",
        decision: "accepted",
        note: "typo confirmed",
        newDistrictName: "  Batanes Lone District  ",
      }),
    );
    expect(mocks.judgeDistrictCorrection).toHaveBeenCalledWith(
      7,
      "accepted",
      ADMIN.email,
      "typo confirmed",
      "Batanes Lone District",
    );

    mocks.judgeDistrictCorrection.mockClear();
    await judgeCorrection(form({ correctionId: "8", decision: "accepted", note: "fine as is" }));
    expect(mocks.judgeDistrictCorrection).toHaveBeenCalledWith(8, "accepted", ADMIN.email, "fine as is", null);
  });

  it("revalidates the queue and index after a judgement", async () => {
    await judgeCorrection(form({ correctionId: "7", decision: "rejected", note: "not this district" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/district-corrections");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/districts");
  });

  it("revalidates the named district page(s) carried on the hidden form fields", async () => {
    await judgeCorrection(
      form({
        correctionId: "7",
        decision: "accepted",
        note: "moved as requested",
        districtCode: "leyte-1st",
        toDistrictCode: "leyte-2nd",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/districts/leyte-1st");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/districts/leyte-2nd");
  });

  it("does not revalidate a district page when no district code was carried", async () => {
    await judgeCorrection(form({ correctionId: "7", decision: "rejected", note: "no source for this" }));
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/admin/district-corrections", "/districts"]);
  });
});
