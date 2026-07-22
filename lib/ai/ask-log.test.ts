import { beforeEach, describe, expect, it, vi } from "vitest";

const { inserts, createSupabaseServiceClient } = vi.hoisted(() => {
  const inserts = [] as Record<string, unknown>[];
  const createSupabaseServiceClient = vi.fn(() => ({
    from: () => ({
      insert: async (values: Record<string, unknown>) => {
        inserts.push(values);
        return { error: null };
      },
    }),
  }));
  return { inserts, createSupabaseServiceClient };
});
vi.mock("@/lib/db/service-client", () => ({ createSupabaseServiceClient }));

const { recordAsk } = await import("./ask-log");

const entry = {
  sessionId: "s-1",
  questionRaw: "How many BHWs?",
  questionNorm: "how many bhws",
  geoCode: "07",
  geoLevel: "region",
  turnIndex: 0,
  answerMd: "There are 5.",
  outcome: "answered" as const,
  provider: "gemini",
  servedFrom: "live" as const,
  dataVersion: "v1",
  toolTrace: [{ name: "getIndicatorByGeo", args: { geoCode: "07" } }],
  latencyMs: 1234,
};

beforeEach(() => {
  inserts.length = 0;
  createSupabaseServiceClient.mockClear();
});

describe("recordAsk", () => {
  it("writes the full snake_case row", async () => {
    await recordAsk(entry);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      session_id: "s-1",
      question_raw: "How many BHWs?",
      question_norm: "how many bhws",
      geo_code: "07",
      geo_level: "region",
      turn_index: 0,
      answer_md: "There are 5.",
      outcome: "answered",
      provider: "gemini",
      served_from: "live",
      data_version: "v1",
      latency_ms: 1234,
    });
  });

  it("does not throw when the service client is unconfigured", async () => {
    createSupabaseServiceClient.mockImplementationOnce(() => {
      throw new Error("unconfigured");
    });
    await expect(recordAsk(entry)).resolves.toBeUndefined();
  });
});
