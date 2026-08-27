import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  judgeKbNode: vi.fn(),
  judgeKbEdge: vi.fn(),
  editKbNode: vi.fn(),
  reopenKbNode: vi.fn(),
  reopenKbEdge: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/require-admin", () => ({ getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/db/kb-review", () => ({
  judgeKbNode: mocks.judgeKbNode,
  judgeKbEdge: mocks.judgeKbEdge,
  editKbNode: mocks.editKbNode,
  reopenKbNode: mocks.reopenKbNode,
  reopenKbEdge: mocks.reopenKbEdge,
  isReviewStatus: (v: unknown) => v === "approved" || v === "rejected",
}));

const { judgeNode, judgeEdge, editNode, reopenRow } = await import("./actions");

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
 * The review queue's server actions (Increment 3.2).
 *
 * Two properties here are security properties rather than behaviour: an action must re-check admin
 * access itself (a form wired to an admin page is not proof the request reached it legitimately),
 * and the reviewer's identity must come from the session rather than the request. §7's whole
 * argument against rubber-stamped review turns on a checkmark meaning someone looked — a
 * `reviewed_by` the caller can set records nothing at all.
 */
describe("kb review actions", () => {
  it("writes nothing when the caller is not an admin", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    await judgeNode(form({ nodeId: "7", status: "approved" }));
    await judgeEdge(form({ edgeId: "7", status: "approved" }));
    await editNode(form({ nodeId: "7", label: "x" }));
    await reopenRow(form({ kind: "node", rowId: "7" }));
    expect(mocks.judgeKbNode).not.toHaveBeenCalled();
    expect(mocks.judgeKbEdge).not.toHaveBeenCalled();
    expect(mocks.editKbNode).not.toHaveBeenCalled();
    expect(mocks.reopenKbNode).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("takes the reviewer from the session and ignores one supplied by the form", async () => {
    await judgeNode(
      form({ nodeId: "7", status: "approved", reviewedBy: "someone.else@example.com" }),
    );
    expect(mocks.judgeKbNode).toHaveBeenCalledWith(7, "approved", ADMIN.email, null);
  });

  it("falls back to the admin id when the session carries no email", async () => {
    mocks.getAdminUser.mockResolvedValue({ ...ADMIN, email: null });
    await judgeEdge(form({ edgeId: "3", status: "rejected", note: "wrong direction" }));
    expect(mocks.judgeKbEdge).toHaveBeenCalledWith(3, "rejected", ADMIN.id, "wrong direction");
  });

  it("refuses a status that is not a judgement", async () => {
    // 'auto' is a real column value but not something this form may set: returning a row to the
    // queue is `reopenRow`, which reopens dependent edges too.
    await judgeNode(form({ nodeId: "7", status: "auto" }));
    await judgeNode(form({ nodeId: "7", status: "approved  " }));
    expect(mocks.judgeKbNode).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a positive integer", async () => {
    for (const nodeId of ["0", "-4", "abc", "1.5", ""]) {
      await judgeNode(form({ nodeId, status: "approved" }));
    }
    expect(mocks.judgeKbNode).not.toHaveBeenCalled();
  });

  it("treats a blank or whitespace-only note as no note", async () => {
    await judgeNode(form({ nodeId: "7", status: "approved", note: "   " }));
    expect(mocks.judgeKbNode).toHaveBeenCalledWith(7, "approved", ADMIN.email, null);
  });

  it("caps a note rather than letting an unbounded string reach the row", async () => {
    await judgeNode(form({ nodeId: "7", status: "rejected", note: "x".repeat(900) }));
    expect(mocks.judgeKbNode.mock.calls[0][3]).toHaveLength(500);
  });

  it("requires a label to save wording, and stores a blank summary as null", async () => {
    await editNode(form({ nodeId: "7", label: "   ", summary: "anything" }));
    expect(mocks.editKbNode).not.toHaveBeenCalled();

    await editNode(form({ nodeId: "7", label: "  UUC for PHC  ", summary: "  " }));
    expect(mocks.editKbNode).toHaveBeenCalledWith(7, "UUC for PHC", null);
  });

  it("dispatches a reopen by row kind, and does nothing for an unknown one", async () => {
    await reopenRow(form({ kind: "node", rowId: "12" }));
    expect(mocks.reopenKbNode).toHaveBeenCalledWith(12);
    await reopenRow(form({ kind: "edge", rowId: "13" }));
    expect(mocks.reopenKbEdge).toHaveBeenCalledWith(13);

    mocks.revalidatePath.mockClear();
    await reopenRow(form({ kind: "column", rowId: "14" }));
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates the queue after a judgement so the page does not show a stale row", async () => {
    await judgeNode(form({ nodeId: "7", status: "approved" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/kb-review");
  });
});
