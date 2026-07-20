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

const { uploadMock, createSupabaseServiceClient } = vi.hoisted(() => {
  const uploadMock = vi.fn(async (): Promise<{ error: { message: string } | null }> => ({
    error: null,
  }));
  const createSupabaseServiceClient = vi.fn(() => ({
    storage: { from: () => ({ upload: uploadMock }) },
  }));
  return { uploadMock, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { POST } = await import("./route");

const SESSION_ID = "3f8a1c2e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";

function post(body: unknown): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const baseSpotBody = {
  sessionId: SESSION_ID,
  pagePath: "/explore",
  category: "bug" as const,
  message: "This number looks wrong",
  pageUrl: "http://localhost/explore?geoLevel=region&geoCode=01",
  selector: "#stat-total",
  context: { tag: "span", elementText: "1,234", viewport: { w: 1440, h: 900 } },
  screenshot: `data:image/jpeg;base64,${Buffer.from("fake").toString("base64")}`,
};

beforeEach(() => {
  insertMock.mockClear();
  uploadMock.mockClear();
  insertResult.current = { error: null };
});

describe("POST /api/feedback", () => {
  it("accepts a full spot payload, uploads the screenshot, and inserts the context columns", async () => {
    const res = await POST(post(baseSpotBody));
    expect(res.status).toBe(200);
    expect(uploadMock).toHaveBeenCalledTimes(1);

    expect(insertMock).toHaveBeenCalledTimes(1);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.page_url).toBe(baseSpotBody.pageUrl);
    expect(row.target_selector).toBe("#stat-total");
    expect(row.context).toMatchObject({ elementText: "1,234" });
    expect(typeof row.screenshot_path).toBe("string");
  });

  it("inserts null spot columns for a plain (non-spot) submission", async () => {
    const res = await POST(
      post({ sessionId: SESSION_ID, pagePath: "/feedback", category: "suggestion", message: "hi" }),
    );
    expect(res.status).toBe(200);
    expect(uploadMock).not.toHaveBeenCalled();
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.page_url).toBeNull();
    expect(row.target_selector).toBeNull();
    expect(row.context).toBeNull();
    expect(row.screenshot_path).toBeNull();
  });

  it("treats a filled honeypot as success without inserting", async () => {
    const res = await POST(post({ ...baseSpotBody, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects an empty message with 400", async () => {
    const res = await POST(post({ ...baseSpotBody, message: "" }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized screenshot with 400", async () => {
    const huge = `data:image/jpeg;base64,${"A".repeat(4 * 1024 * 1024 + 10)}`;
    const res = await POST(post({ ...baseSpotBody, screenshot: huge }));
    expect(res.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still inserts (with null screenshot_path) when the upload fails", async () => {
    uploadMock.mockResolvedValueOnce({ error: { message: "boom" } });
    const res = await POST(post(baseSpotBody));
    expect(res.status).toBe(200);
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.screenshot_path).toBeNull();
  });
});
