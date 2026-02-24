import Anthropic from "@anthropic-ai/sdk";
import type { LLMAdapter, Message, LLMResponse, LLMToolDefinition } from "@pace-agent/core";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  baseURL?: string;
  model: string;
  defaultMaxTokens?: number;
}

export class AnthropicAdapter implements LLMAdapter {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  constructor(options: AnthropicAdapterOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.model = options.model;
    this.defaultMaxTokens = options.defaultMaxTokens ?? 2048;
  }

  async chat(params: {
    messages: Message[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const system = this.extractSystem(params.messages);
    const anthropicMessages = this.toAnthropicMessages(params.messages);
    const anthropicTools =
      params.tools && params.tools.length > 0 ? this.toAnthropicTools(params.tools) : undefined;

    const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: params.maxTokens ?? this.defaultMaxTokens,
      messages: anthropicMessages,
      ...(system ? { system } : {}),
      ...(anthropicTools ? { tools: anthropicTools } : {}),
    };

    const response = await this.client.messages.create(requestParams);
    return this.fromAnthropicResponse(response.content, response.usage, response.stop_reason);
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Extract the system prompt from the message array (Anthropic requires it as a separate param) */
  private extractSystem(messages: Message[]): string | undefined {
    const systemMsg = messages.find((m) => m.role === "system");
    return systemMsg?.content || undefined;
  }

  /**
   * Convert Pace messages (OpenAI-style) to Anthropic MessageParam format.
   *
   * Key differences:
   * - system messages are excluded (handled separately)
   * - tool messages (role="tool") become user messages with type="tool_result" blocks
   * - consecutive tool messages MUST be merged into a single user message
   * - assistant tool calls become content blocks with type="tool_use"
   */
  private toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
    const nonSystem = messages.filter((m) => m.role !== "system");
    const result: Anthropic.MessageParam[] = [];
    let i = 0;

    while (i < nonSystem.length) {
      const msg = nonSystem[i]!;

      if (msg.role === "tool") {
        // Batch all consecutive tool messages into a single user message
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        while (i < nonSystem.length && nonSystem[i]!.role === "tool") {
          const toolMsg = nonSystem[i]!;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolMsg.toolCallId ?? "",
            content: toolMsg.content,
          });
          i++;
        }
        result.push({ role: "user", content: toolResults });
        continue; // i already advanced in inner loop
      }

      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Build content array: optional text block + tool_use blocks.
          // Use ContentBlockParam types (request side), not ContentBlock (response side).
          const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];
          if (msg.content) {
            contentBlocks.push({ type: "text", text: msg.content });
          }
          for (const tc of msg.toolCalls) {
            let inputObj: Record<string, unknown>;
            try {
              inputObj = JSON.parse(tc.arguments) as Record<string, unknown>;
            } catch {
              inputObj = {};
            }
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: inputObj,
            });
          }
          result.push({ role: "assistant", content: contentBlocks });
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
      }

      i++;
    }

    return result;
  }

  private toAnthropicTools(tools: LLMToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    }));
  }

  private fromAnthropicResponse(
    content: Anthropic.ContentBlock[],
    usage: Anthropic.Usage,
    stopReason: string | null,
  ): LLMResponse {
    let text = "";
    const toolCalls: LLMResponse["toolCalls"] = [];

    for (const block of content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    return {
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
      finishReason: this.mapStopReason(stopReason),
    };
  }

  private mapStopReason(reason: string | null): LLMResponse["finishReason"] {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "tool_use":
        return "tool_calls";
      case "max_tokens":
        return "length";
      default:
        return "error";
    }
  }
}
