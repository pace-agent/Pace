import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaceRuntime } from "./PaceRuntime.js";
import type { LLMAdapter, Message, LLMResponse } from "../types/llm.js";
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "../types/resource.js";
import type { TraceWriter } from "../types/trace.js";
import type { ToolProvider, ToolDefinition } from "../types/tool.js";

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

/** A ResourceProvider that also implements ToolProvider */
function makeToolProvider(): ResourceProvider & ToolProvider {
  const toolDef: ToolDefinition = {
    name: "web_search",
    description: "Search the web",
    tags: ["search"],
    risk: "low" as const,
    preview: "Search the web for information",
    parameters: { type: "object", properties: { query: { type: "string" } } },
    execute: async () => ({ results: [] }),
  };
  return {
    type: "tool" as const,
    listL0: vi.fn().mockResolvedValue([{
      id: "tool:web_search",
      name: "Web Search",
      description: "Search the web",
      type: "tool" as const,
      tags: ["search"],
    }]),
    getL1: vi.fn().mockResolvedValue({
      id: "tool:web_search",
      name: "Web Search",
      description: "Search the web",
      type: "tool" as const,
      tags: ["search"],
      summary: "Search the web for current information",
    }),
    getL2: vi.fn().mockResolvedValue({} as L2Payload),
    listTools: vi.fn().mockResolvedValue([toolDef]),
    getTool: vi.fn().mockResolvedValue(toolDef),
    executeTool: vi.fn().mockResolvedValue({
      success: true,
      output: { results: ["TypeScript 5.4 advisory"] },
      latencyMs: 50,
    }),
  };
}

function makeTracer(): TraceWriter {
  return {
    write: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PaceRuntime — basic", () => {
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

  it("normal run has stopped=false and toolCallsExecuted=0", async () => {
    const runtime = new PaceRuntime({ llm: adapter, tracer });
    const result = await runtime.run("Hello");
    expect(result.stopped).toBe(false);
    expect(result.toolCallsExecuted).toBe(0);
  });
});

describe("PaceRuntime — agentic loop", () => {
  let tracer: TraceWriter;

  beforeEach(() => {
    tracer = makeTracer();
  });

  it("executes tool call and returns final reply", async () => {
    const toolCallsResp: LLMResponse = {
      content: "I'll search for that.",
      toolCalls: [{ id: "tc1", name: "web_search", arguments: '{"query":"TypeScript"}' }],
      usage: { inputTokens: 100, outputTokens: 15 },
      finishReason: "tool_calls",
    };
    const finalResp: LLMResponse = {
      content: "Here are the search results.",
      usage: { inputTokens: 150, outputTokens: 30 },
      finishReason: "stop",
    };
    const adapter: LLMAdapter = {
      chat: vi.fn()
        .mockResolvedValueOnce(toolCallsResp)
        .mockResolvedValueOnce(finalResp),
      estimateTokens: (t) => Math.ceil(t.length / 4),
    };

    const toolProvider = makeToolProvider();
    const runtime = new PaceRuntime({ llm: adapter, tracer, resources: [toolProvider] });
    const result = await runtime.run("Search for TypeScript security");

    expect(result.reply).toBe("Here are the search results.");
    expect(result.stopped).toBe(false);
    expect(result.toolCallsExecuted).toBe(1);

    const toolEvents = result.trace.filter((e) => e.type === "TOOL_INVOKED");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]!.type === "TOOL_INVOKED" && (toolEvents[0] as { toolName: string }).toolName).toBe("web_search");
  });

  it("stops with 'retry' reason after consecutive tool errors (no provider)", async () => {
    const toolCallsResp: LLMResponse = {
      content: "",
      toolCalls: [{ id: "tc1", name: "web_search", arguments: "{}" }],
      usage: { inputTokens: 100, outputTokens: 10 },
      finishReason: "tool_calls",
    };
    const adapter: LLMAdapter = {
      chat: vi.fn().mockResolvedValue(toolCallsResp),
      estimateTokens: (t) => Math.ceil(t.length / 4),
    };

    const runtime = new PaceRuntime({
      llm: adapter,
      tracer,
      config: { termination: { maxRetries: 2 } },
    });
    const result = await runtime.run("Search for me");

    expect(result.stopped).toBe(true);
    expect(result.stopReason).toBe("retry");
    expect(result.toolCallsExecuted).toBe(0);

    const stopEvent = result.trace.find((e) => e.type === "STOP_TRIGGERED");
    expect(stopEvent).toBeDefined();
  });

  it("injects tool result into next LLM call messages", async () => {
    const toolCallsResp: LLMResponse = {
      content: "searching...",
      toolCalls: [{ id: "tc1", name: "web_search", arguments: '{"query":"test"}' }],
      usage: { inputTokens: 100, outputTokens: 10 },
      finishReason: "tool_calls",
    };
    const finalResp: LLMResponse = {
      content: "Done.",
      usage: { inputTokens: 200, outputTokens: 20 },
      finishReason: "stop",
    };
    const adapter: LLMAdapter = {
      chat: vi.fn()
        .mockResolvedValueOnce(toolCallsResp)
        .mockResolvedValueOnce(finalResp),
      estimateTokens: (t) => Math.ceil(t.length / 4),
    };

    const toolProvider = makeToolProvider();
    const runtime = new PaceRuntime({ llm: adapter, tracer, resources: [toolProvider] });
    await runtime.run("Search");

    // Second chat call should include a "tool" role message
    const secondCall = (adapter.chat as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const toolMessages = (secondCall.messages as Message[]).filter((m) => m.role === "tool");
    expect(toolMessages).toHaveLength(1);
    expect(toolMessages[0]!.toolCallId).toBe("tc1");
  });
});
