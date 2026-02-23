// ---- LLM Adapter ----

/** Role of a message in a conversation */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A single message in a conversation */
export interface Message {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

/** Tool call requested by the LLM */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Response from an LLM call */
export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason: "stop" | "tool_calls" | "length" | "error";
}

/** Definition of a tool for the LLM function-calling interface */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * LLMAdapter — pluggable interface for LLM providers.
 * Pace does not call LLM APIs directly; users inject their own adapter.
 */
export interface LLMAdapter {
  /** Send messages and get a response */
  chat(params: {
    messages: Message[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
  }): Promise<LLMResponse>;

  /** Estimate token count for a string (used for budget control) */
  estimateTokens(text: string): number;
}
