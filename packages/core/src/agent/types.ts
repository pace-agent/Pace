// ---- Agent Loop Types ----

import type { Message, LLMResponse, ToolCall, ToolResult } from "../index.js";

/**
 * Agent Loop options.
 */
export interface AgentLoopOptions {
  /** Maximum iterations (default: 50) */
  maxIterations?: number;

  /** Maximum tokens per task */
  maxTokens?: number;

  /** Callback when tool is about to execute */
  onToolCall?: (tool: string, params: Record<string, unknown>) => Promise<void> | void;

  /** Callback when LLM response is received */
  onResponse?: (response: LLMResponse) => void;

  /** Callback when iteration completes */
  onIteration?: (iteration: number, context: AgentContext) => void;

  /** Callback on error */
  onError?: (error: Error, iteration: number) => void;
}

/**
 * Agent execution context.
 */
export interface AgentContext {
  /** Conversation history */
  messages: Message[];

  /** Accumulated tool results */
  toolResults: ToolResult[];

  /** Current iteration */
  iteration: number;

  /** Token usage */
  tokens: {
    input: number;
    output: number;
    total: number;
  };

  /** Whether the agent should stop */
  shouldStop: boolean;

  /** Stop reason if shouldStop is true */
  stopReason?: string;
}

/**
 * Agent loop result.
 */
export interface AgentResult {
  /** Final response text */
  response: string;

  /** All tool calls made */
  toolCalls: Array<{
    id: string;
    tool: string;
    params: Record<string, unknown>;
    result: string;
    success: boolean;
  }>;

  /** Total iterations */
  iterations: number;

  /** Token usage */
  tokens: {
    input: number;
    output: number;
    total: number;
  };

  /** Whether completed successfully */
  success: boolean;

  /** Stop reason */
  stopReason?: string;
}

/**
 * LLM response with tool calls.
 */
export interface LLMResponseWithTools extends LLMResponse {
  /** Tool calls requested by LLM */
  toolCalls?: ToolCall[];
}
