import { vi, describe, it, expect, beforeEach } from "vitest";

const mockCreate = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

import { OpenAIAdapter } from "./OpenAIAdapter.js";

describe("OpenAIAdapter", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Hello from OpenAI!", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });
  });

  it("maps messages and returns LLMResponse", async () => {
    const adapter = new OpenAIAdapter({ model: "gpt-4o", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.content).toBe("Hello from OpenAI!");
    expect(response.finishReason).toBe("stop");
    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
  });

  it("maps tool_calls finish reason and returns tool calls", async () => {
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "tc1", function: { name: "search", arguments: "{}" } }],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 80, completion_tokens: 20 },
    });

    const adapter = new OpenAIAdapter({ model: "gpt-4o", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Search" }],
    });

    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.name).toBe("search");
  });

  it("estimates tokens as ceil(length/4)", () => {
    const adapter = new OpenAIAdapter({ model: "gpt-4o", apiKey: "test-key" });
    expect(adapter.estimateTokens("hello")).toBe(2); // ceil(5/4) = 2
    expect(adapter.estimateTokens("a".repeat(100))).toBe(25); // ceil(100/4) = 25
  });

  it("maps unknown finish_reason to error", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "" }, finish_reason: "content_filter" }],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    });

    const adapter = new OpenAIAdapter({ model: "gpt-4o", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.finishReason).toBe("error");
  });

  it("maps length finish reason", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "truncated" }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 100 },
    });

    const adapter = new OpenAIAdapter({ model: "gpt-4o", apiKey: "test-key" });
    const response = await adapter.chat({
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(response.finishReason).toBe("length");
  });
});
