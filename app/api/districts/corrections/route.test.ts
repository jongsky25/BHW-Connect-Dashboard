import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture what the anon insert client receives, and let tests toggle its error result.
const { insertMock, insertResult, createSupabaseServerClient } = vi.hoisted(() => {
  const insertMock = vi.fn();
  const insertResult = { current: { error: null as unknown } };
  const createSupabaseServerClient = vi.fn(() => ({
    from: () => ({
      insert: (row: unknown) => {
        insertMock(row);
        return Promise.resolve(insertResult.current);
      },
    }),
  }));
  return { insertMock, insertResult, createSupabaseServerClient };
});
vi.mock("@/lib/db/supabase", () => ({ createSupabaseServerClient }));

// D2.5 — a submission is published on the public ledger, which is on a 1-hour window like every
// other district page. The route expires it so the promise made to the submitter is true now
// rather than eventually.
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

const { POST } = await import("./route");

const SESSION_ID = "3f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

function post(body: unknown): Request {
  return new Request("http://localhost/api/districts/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseAddBody = {
  sessionId: SESSION_ID,
  action: "add" as const,
  districtCode: "leyte-1st",
  geoCode: "0803701",
  rationale: "This municipality is missing from the district's member list.",
};

beforeEach(() => {
  insertMock.mockClear();
  revalidatePath.mockClear();
  insertResult.current = { error: null };
});

describe("POST /api/districts/corrections", () => {
  it("accepts an 'add' proposal and inserts the structured row", async () => {
    const res = await POST(post(baseAddBody));
    expect(res.status).toBe(200);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      session_id: SESSION_ID,
      action: "add",
      district_code: "leyte-1st",
      geo_code: "0803701",
      to_district_code: null,
      submitter_email: null,
    });
  });

  it("requires a destination district for a 'move' proposal", async () => {
    const res = await POST(
      post({
        ...baseAddBody,
        action: "move",
        toDistrictCode: undefined,
      }),
    );
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("accepts a 'move' proposal carrying both district codes", async () => {
    const res = await POST(
      post({
        ...baseAddBody,
        action: "move",
        toDistrictCode: "leyte-2nd",
      }),
    );
    expect(res.status).toBe(200);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      action: "move",
      district_code: "leyte-1st",
      to_district_code: "leyte-2nd",
      geo_code: "0803701",
    });
  });

  it("requires geoCode for add/remove/move but not for rename/other", async () => {
    const missingGeo = await POST(post({ ...baseAddBody, geoCode: undefined }));
    expect(missingGeo.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();

    const rename = await POST(
      post({
        sessionId: SESSION_ID,
        action: "rename",
        districtCode: "leyte-1st",
        rationale: "The district name has a typo.",
      }),
    );
    expect(rename.status).toBe(200);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ action: "rename", geo_code: null });
  });

  it("treats a filled honeypot as success without inserting", async () => {
    const res = await POST(post({ ...baseAddBody, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an empty rationale with 400", async () => {
    const res = await POST(post({ ...baseAddBody, rationale: "" }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a rationale over the 2,000-char cap", async () => {
    const res = await POST(post({ ...baseAddBody, rationale: "a".repeat(2001) }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed evidence URL", async () => {
    const res = await POST(post({ ...baseAddBody, evidenceUrl: "not-a-url" }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("never publishes the submitter email, only stores it for contact-back", async () => {
    const res = await POST(post({ ...baseAddBody, email: "reporter@example.com" }));
    expect(res.status).toBe(200);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ submitter_email: "reporter@example.com" });
  });

  it("returns 500 when the insert fails", async () => {
    insertResult.current = { error: { message: "boom" } };
    const res = await POST(post(baseAddBody));
    expect(res.status).toBe(500);
  });

  it("expires the public ledger so a new proposal shows up there immediately", async () => {
    await POST(post(baseAddBody));
    expect(revalidatePath).toHaveBeenCalledWith("/districts/corrections");
  });

  it("expires nothing when there was no submission to publish", async () => {
    await POST(post({ ...baseAddBody, website: "http://spam.example" }));
    await POST(post({ ...baseAddBody, rationale: "" }));
    insertResult.current = { error: { message: "boom" } };
    await POST(post(baseAddBody));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
