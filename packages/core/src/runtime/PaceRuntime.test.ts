import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaceRuntime } from "./PaceRuntime.js";
import type { LLMAdapter, Message, LLMResponse } from "../types/llm.js";
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "../types/resource.js";
import type { TraceWriter } from "../types/trace.js";

function makeAdapter(): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({
      content: "Hello! I can help you.",
      usage: { inputTokens: 150, outputTokens: 20 },
      finishReason: "stop",
    } satisfies LLMResponse),
    estimateTokens: (t: string) => Math.ceil(t.length / 4),
  };
}

function makeProvider(type: ResourceProvider["type"], ids: string[]): ResourceProvider {
  const l0: L0Index[] = ids.map((id) => ({
    id,
    name: id,
    description: `Description for ${id}`,
    type,
    tags: [type],
    riskLevel: "low" as const,
  }));
  return {
    type,
    listL0: vi.fn().mockResolvedValue(l0),
    getL1: vi.fn().mockImplementation(
      async (id: string): Promise<L1Preview> => ({
        ...l0.find((r) => r.id === id)!,
        summary: `Summary for ${id}`,
      }),
    ),
    getL2: vi.fn().mockResolvedValue({} as L2Payload),
  };
}

function makeTracer(): TraceWriter {
  return {
    write: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PaceRuntime", () => {
  let adapter: LLMAdapter;
  let tracer: TraceWriter;

  beforeEach(() => {
    adapter = makeAdapter();
    tracer = makeTracer();
  });

  it("returns reply from LLM", async () => {
    const runtime = new PaceRuntime({ llm: adapter, tracer });
    const result = await runtime.run("Hello");
    expect(result.reply).toBe("Hello! I can help you.");
  });

  it("includes system prompt with PACE context", async () => {
    const runtime = new PaceRuntime({ llm: adapter, tracer });
    await runtime.run("Hello");

    const callArgs = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = (callArgs.messages as Message[]).find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("[PACE RUNTIME CONTEXT]");
  });

  it("accumulates conversation history across turns", async () => {
    const runtime = new PaceRuntime({ llm: adapter, tracer });
    await runtime.run("First message");
    await runtime.run("Second message");

    const secondCallArgs = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const messages = secondCallArgs.messages as Message[];
    const userMessages = messages.filter((m) => m.role === "user");
    expect(userMessages.length).toBe(2);
  });

  it("includes resources from registered providers", async () => {
    const provider = makeProvider("tool", ["tool:web_search"]);
    const runtime = new PaceRuntime({ llm: adapter, tracer, resources: [provider] });
    await runtime.run("Hello");

    const callArgs = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const systemMsg = (callArgs.messages as Message[]).find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("tool:web_search");
  });

  it("emits LLM_CALL_START and LLM_CALL_END trace events", async () => {
    const runtime = new PaceRuntime({ llm: adapter, tracer });
    const result = await runtime.run("Hello");

    const types = result.trace.map((e) => e.type);
    expect(types).toContain("LLM_CALL_START");
    expect(types).toContain("LLM_CALL_END");
  });

  it("records token usage correctly", async () => {
    const runtime = new PaceRuntime({ llm: adapter, tracer });
    const result = await runtime.run("Hello");

    expect(result.tokenUsage.inputTokens).toBe(150);
    expect(result.tokenUsage.outputTokens).toBe(20);
    expect(result.tokenUsage.totalTokens).toBe(170);
  });

  it("warns but does not fail on tool_calls finish reason", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (adapter.chat as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: "",
      toolCalls: [{ id: "tc1", name: "web_search", arguments: "{}" }],
      usage: { inputTokens: 100, outputTokens: 10 },
      finishReason: "tool_calls",
    });

    const runtime = new PaceRuntime({ llm: adapter, tracer });
    const result = await runtime.run("Search for me");

    expect(result.finishReason).toBe("tool_calls");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
