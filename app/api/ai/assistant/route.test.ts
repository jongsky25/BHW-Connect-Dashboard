import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getAdminUser,
  runToolLoop,
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
  internalTools,
} = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  runToolLoop: vi.fn(),
  isInternalAssistantRateLimited: vi.fn(),
  recordInternalAssistantMessage: vi.fn(),
  internalTools: [
    {
      definition: {
        name: "queryDataset",
        description: "",
        parameters: { type: "object" as const, properties: {} },
      },
      execute: vi.fn(),
    },
  ],
}));

vi.mock("@/lib/db/require-admin", () => ({ getAdminUser }));
vi.mock("@/lib/ai/agent-loop", () => ({ runToolLoop }));
vi.mock("@/lib/ai/rate-limit", () => ({
  isInternalAssistantRateLimited,
  recordInternalAssistantMessage,
}));
vi.mock("@/lib/ai/dataset-tools", () => ({ createInternalTools: () => internalTools }));

const { POST } = await import("./route");

const ADMIN = {
  id: "11111111-2222-3333-4444-555555555555",
  email: "staff@example.gov.ph",
  role: "admin" as const,
};

function ask(question = "How many provinces are on the UUC list?"): Request {
  return new Request("http://localhost/api/ai/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: question }] }),
  });
}

/** Collects the NDJSON events a streamed response emits. */
async function eventsOf(response: Response): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

beforeEach(() => {
  getAdminUser.mockReset().mockResolvedValue(ADMIN);
  runToolLoop.mockReset();
  isInternalAssistantRateLimited.mockReset().mockResolvedValue(false);
  recordInternalAssistantMessage.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/ai/assistant — the admin boundary", () => {
  it("refuses an anonymous request with 401 and never reaches a provider", async () => {
    getAdminUser.mockResolvedValue(null);

    const response = await POST(ask());

    expect(response.status).toBe(401);
    expect(runToolLoop).not.toHaveBeenCalled();
    // The check happens before the body is even parsed: nothing about the request should be able
    // to influence whether the gate opens.
    expect(recordInternalAssistantMessage).not.toHaveBeenCalled();
  });

  it("checks the admin session on the route itself, not only on the page", async () => {
    await POST(ask());
    expect(getAdminUser).toHaveBeenCalled();
  });

  it("rejects a malformed body with 400", async () => {
    const response = await POST(
      new Request("http://localhost/api/ai/assistant", { method: "POST", body: "{}" }),
    );
    expect(response.status).toBe(400);
    expect(runToolLoop).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/assistant — limits and tool set", () => {
  it("returns 429 once the admin's own limit is reached, without calling a provider", async () => {
    isInternalAssistantRateLimited.mockResolvedValue(true);

    const response = await POST(ask());

    expect(response.status).toBe(429);
    expect(isInternalAssistantRateLimited).toHaveBeenCalledWith(ADMIN.id);
    expect(runToolLoop).not.toHaveBeenCalled();
  });

  it("runs the loop with the internal tool set and the internal system prompt", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "No figures here.",
      toolPayloads: [],
      provider: "gemini",
      allCapped: false,
    });

    await POST(ask());

    const [messages, , tools] = runToolLoop.mock.calls[0];
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("internal data assistant");
    expect(tools).toBe(internalTools);
    expect(recordInternalAssistantMessage).toHaveBeenCalledWith(ADMIN.id);
  });

  it("streams each tool call with its arguments, then the answer", async () => {
    runToolLoop.mockImplementation(async (_messages: unknown, onToolCall: (e: unknown) => void) => {
      onToolCall({ name: "queryDataset", args: { table: "agg_poverty", limit: 5 } });
      return {
        finalText: "Poverty data covers city and municipality level only.",
        toolPayloads: [{ rows: [] }],
        provider: "gemini",
        allCapped: false,
      };
    });

    const events = await eventsOf(await POST(ask()));

    expect(events[0]).toEqual({
      type: "tool_call",
      name: "queryDataset",
      args: { table: "agg_poverty", limit: 5 },
    });
    expect(events[1]).toMatchObject({ type: "message", provider: "gemini" });
  });
});

describe("POST /api/ai/assistant — grounding is not relaxed", () => {
  it("strips a sentence whose number is in no tool payload", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Region VII has 4,210 profiled BHWs. Coverage is uneven across its provinces.",
      toolPayloads: [{ rows: [{ geo_code: "07", n_total: 3891 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const [event] = await eventsOf(await POST(ask()));

    expect(event.content).toBe("Coverage is uneven across its provinces.");
    expect(event.content).not.toContain("4,210");
  });

  it("keeps a figure that is in a tool payload", async () => {
    runToolLoop.mockResolvedValue({
      finalText: "Region VII has 3,891 profiled BHWs.",
      toolPayloads: [{ rows: [{ geo_code: "07", n_total: 3891 }] }],
      provider: "gemini",
      allCapped: false,
    });

    const [event] = await eventsOf(await POST(ask()));

    expect(event.content).toBe("Region VII has 3,891 profiled BHWs.");
  });

  it("reports capacity rather than answering when every provider is capped", async () => {
    runToolLoop.mockResolvedValue({
      finalText: null,
      toolPayloads: [],
      provider: null,
      allCapped: true,
    });

    const [event] = await eventsOf(await POST(ask()));

    expect(event).toMatchObject({ type: "capacity" });
  });
});
