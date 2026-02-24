import { vi, describe, it, expect, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { AnthropicAdapter } from "./AnthropicAdapter.js";

function makeResponse(overrides: {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
}) {
  return {
    content: overrides.content ?? [{ type: "text", text: "Hello from Anthropic!" }],
    usage: overrides.usage ?? { input_tokens: 100, output_tokens: 50 },
    stop_reason: overrides.stop_reason ?? "end_turn",
  };
}

describe("AnthropicAdapter", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue(makeResponse({}));
  });

  it("maps messages and returns LLMResponse for plain text", async () => {
    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.content).toBe("Hello from Anthropic!");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
    expect(response.toolCalls).toBeUndefined();
  });

  it("maps tool_use content blocks to toolCalls", async () => {
    mockCreate.mockResolvedValue(
      makeResponse({
        content: [{ type: "tool_use", id: "tu1", name: "search", input: { query: "test" } }],
        stop_reason: "tool_use",
      }),
    );

    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Search" }],
    });

    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.id).toBe("tu1");
    expect(response.toolCalls![0]!.name).toBe("search");
    expect(JSON.parse(response.toolCalls![0]!.arguments)).toEqual({ query: "test" });
  });

  it("merges consecutive tool messages into a single user message", async () => {
    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    await adapter.chat({
      messages: [
        { role: "user", content: "Call two tools" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "tc1", name: "tool_a", arguments: "{}" },
            { id: "tc2", name: "tool_b", arguments: "{}" },
          ],
        },
        { role: "tool", content: "result a", toolCallId: "tc1" },
        { role: "tool", content: "result b", toolCallId: "tc2" },
      ],
    });

    const callArg = mockCreate.mock.calls[0]![0];
    const messages = callArg.messages as Array<{ role: string; content: unknown }>;

    // The two tool messages should be collapsed into one user message
    const toolResultMessages = messages.filter((m) => m.role === "user" && Array.isArray(m.content));
    expect(toolResultMessages).toHaveLength(1);

    const toolResults = toolResultMessages[0]!.content as Array<{ type: string; tool_use_id: string }>;
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]!.type).toBe("tool_result");
    expect(toolResults[0]!.tool_use_id).toBe("tc1");
    expect(toolResults[1]!.tool_use_id).toBe("tc2");
  });

  it("extracts system message as separate param (not in messages array)", async () => {
    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    await adapter.chat({
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello" },
      ],
    });

    const callArg = mockCreate.mock.calls[0]![0];
    expect(callArg.system).toBe("You are a helpful assistant.");

    const msgRoles = (callArg.messages as Array<{ role: string }>).map((m) => m.role);
    expect(msgRoles).not.toContain("system");
  });

  it("handles mixed text + tool_use content in response", async () => {
    mockCreate.mockResolvedValue(
      makeResponse({
        content: [
          { type: "text", text: "Let me search for that." },
          { type: "tool_use", id: "tu1", name: "search", input: { q: "test" } },
        ],
        stop_reason: "tool_use",
      }),
    );

    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Search for test" }],
    });

    expect(response.content).toBe("Let me search for that.");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.finishReason).toBe("tool_calls");
  });

  it("maps max_tokens stop_reason to 'length'", async () => {
    mockCreate.mockResolvedValue(makeResponse({ stop_reason: "max_tokens" }));

    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    const response = await adapter.chat({ messages: [{ role: "user", content: "Hello" }] });

    expect(response.finishReason).toBe("length");
  });

  it("maps unknown stop_reason to 'error'", async () => {
    mockCreate.mockResolvedValue(makeResponse({ stop_reason: "unknown_reason" }));

    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    const response = await adapter.chat({ messages: [{ role: "user", content: "Hello" }] });

    expect(response.finishReason).toBe("error");
  });

  it("estimateTokens returns ceil(length/4)", () => {
    const adapter = new AnthropicAdapter({ model: "claude-opus-4-6", apiKey: "test-key" });
    expect(adapter.estimateTokens("hello")).toBe(2); // ceil(5/4) = 2
    expect(adapter.estimateTokens("a".repeat(100))).toBe(25); // ceil(100/4) = 25
  });
});
