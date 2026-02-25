import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentLoop } from "./AgentLoop.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import type { LLMAdapter, Message, LLMResponse } from "../types/llm.js";
import type { ToolDefinition } from "../tools/types.js";

// Mock LLM Adapter
class MockLLMAdapter implements LLMAdapter {
  private responses: LLMResponse[] = [];
  private callCount = 0;

  setResponses(responses: LLMResponse[]) {
    this.responses = responses;
    this.callCount = 0;
  }

  async chat(params: { messages: Message[]; maxTokens?: number; tools?: any }): Promise<LLMResponse> {
    const response = this.responses[this.callCount] || {
      content: "No more responses",
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: "stop",
    };
    this.callCount++;
    return response;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

describe("AgentLoop", () => {
  let llm: MockLLMAdapter;
  let executor: ToolExecutor;
  let loop: AgentLoop;

  beforeEach(() => {
    llm = new MockLLMAdapter();
    executor = new ToolExecutor();

    // Register a simple echo tool
    executor.register(
      {
        name: "echo",
        description: "Echo the input",
        parameters: {
          type: "object",
          properties: { message: { type: "string" } },
          required: ["message"],
        },
      },
      async (params) => ({ echoed: params.message })
    );

    loop = new AgentLoop(llm, executor, { maxIterations: 10 });
  });

  describe("basic execution", () => {
    it("should return response without tool calls", async () => {
      llm.setResponses([
        {
          content: "Hello, how can I help?",
          usage: { inputTokens: 10, outputTokens: 8 },
          finishReason: "stop",
        },
      ]);

      const result = await loop.run([{ role: "user", content: "Hi" }]);

      expect(result.success).toBe(true);
      expect(result.response).toBe("Hello, how can I help?");
      expect(result.iterations).toBe(1);
      expect(result.toolCalls).toHaveLength(0);
    });

    it("should execute tool calls and continue", async () => {
      llm.setResponses([
        {
          content: "",
          toolCalls: [{ id: "1", name: "echo", params: { message: "test" } }],
          usage: { inputTokens: 20, outputTokens: 10 },
          finishReason: "tool_calls",
        } as any,
        {
          content: "The echo result is: test",
          usage: { inputTokens: 30, outputTokens: 15 },
          finishReason: "stop",
        },
      ]);

      const result = await loop.run([{ role: "user", content: "Echo test" }]);

      expect(result.success).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].tool).toBe("echo");
      expect(result.toolCalls[0].success).toBe(true);
      expect(result.iterations).toBe(2);
    });
  });

  describe("iteration limits", () => {
    it("should stop at maxIterations", async () => {
      // Always return tool calls to force max iterations
      let callCount = 0;
      llm.setResponses([]);
      
      // Override chat to always return tool calls
      (llm as any).chat = async () => {
        callCount++;
        return {
          content: "",
          toolCalls: [{ id: `${callCount}`, name: "echo", params: { message: "loop" } }],
          usage: { inputTokens: 5, outputTokens: 5 },
          finishReason: "tool_calls",
        };
      };

      const shortLoop = new AgentLoop(llm, executor, { maxIterations: 3 });
      const result = await shortLoop.run([{ role: "user", content: "Loop" }]);

      expect(result.iterations).toBe(3);
      expect(result.stopReason).toBe("max_iterations");
    });
  });

  describe("callbacks", () => {
    it("should call onToolCall callback", async () => {
      const onToolCall = vi.fn();

      llm.setResponses([
        {
          content: "",
          toolCalls: [{ id: "1", name: "echo", params: { message: "hi" } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool_calls",
        } as any,
        { content: "Done", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" },
      ]);

      const loopWithCallback = new AgentLoop(llm, executor, { onToolCall });
      await loopWithCallback.run([{ role: "user", content: "Test" }]);

      expect(onToolCall).toHaveBeenCalledWith("echo", { message: "hi" });
    });

    it("should call onResponse callback", async () => {
      const onResponse = vi.fn();

      llm.setResponses([
        { content: "Response", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" },
      ]);

      const loopWithCallback = new AgentLoop(llm, executor, { onResponse });
      await loopWithCallback.run([{ role: "user", content: "Test" }]);

      expect(onResponse).toHaveBeenCalledTimes(1);
    });

    it("should call onIteration callback", async () => {
      const onIteration = vi.fn();

      llm.setResponses([
        {
          content: "",
          toolCalls: [{ id: "1", name: "echo", params: { message: "a" } }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool_calls",
        } as any,
        { content: "Done", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" },
      ]);

      const loopWithCallback = new AgentLoop(llm, executor, { onIteration });
      await loopWithCallback.run([{ role: "user", content: "Test" }]);

      expect(onIteration).toHaveBeenCalledTimes(1);
    });
  });

  describe("token tracking", () => {
    it("should track token usage", async () => {
      llm.setResponses([
        {
          content: "",
          toolCalls: [{ id: "1", name: "echo", params: { message: "x" } }],
          usage: { inputTokens: 100, outputTokens: 50 },
          finishReason: "tool_calls",
        } as any,
        { content: "Done", usage: { inputTokens: 200, outputTokens: 100 }, finishReason: "stop" },
      ]);

      const result = await loop.run([{ role: "user", content: "Test" }]);

      expect(result.tokens.input).toBe(300);
      expect(result.tokens.output).toBe(150);
      expect(result.tokens.total).toBe(450);
    });
  });

  describe("error handling", () => {
    it("should handle tool execution errors", async () => {
      executor.register(
        {
          name: "fail",
          description: "Always fails",
          parameters: { type: "object", properties: {} },
        },
        async () => {
          throw new Error("Tool failed");
        }
      );

      llm.setResponses([
        {
          content: "",
          toolCalls: [{ id: "1", name: "fail", params: {} }],
          usage: { inputTokens: 10, outputTokens: 5 },
          finishReason: "tool_calls",
        } as any,
        { content: "Recovered", usage: { inputTokens: 10, outputTokens: 5 }, finishReason: "stop" },
      ]);

      const result = await loop.run([{ role: "user", content: "Test" }]);

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].success).toBe(false);
      expect(result.toolCalls[0].result).toContain("Tool failed");
    });
  });
});
