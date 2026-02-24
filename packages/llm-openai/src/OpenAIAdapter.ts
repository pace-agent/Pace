import OpenAI from "openai";
import type { LLMAdapter, Message, LLMResponse, LLMToolDefinition } from "@pace-agent/core";

export interface OpenAIAdapterOptions {
  apiKey?: string;
  baseURL?: string;
  model: string;
  defaultMaxTokens?: number;
}

export class OpenAIAdapter implements LLMAdapter {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultMaxTokens: number;

  constructor(options: OpenAIAdapterOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: options.baseURL,
    });
    this.model = options.model;
    this.defaultMaxTokens = options.defaultMaxTokens ?? 2048;
  }

  async chat(params: {
    messages: Message[];
    tools?: LLMToolDefinition[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = params.messages.map((m) => {
      switch (m.role) {
        case "system":
          return { role: "system", content: m.content, ...(m.name ? { name: m.name } : {}) };
        case "user":
          return { role: "user", content: m.content, ...(m.name ? { name: m.name } : {}) };
        case "assistant":
          return {
            role: "assistant",
            content: m.content,
            ...(m.name ? { name: m.name } : {}),
            ...(m.toolCalls
              ? {
                  tool_calls: m.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: { name: tc.name, arguments: tc.arguments },
                  })),
                }
              : {}),
          };
        case "tool":
          return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
      }
    });

    const openaiTools = params.tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openaiMessages,
      ...(openaiTools?.length ? { tools: openaiTools } : {}),
      max_tokens: params.maxTokens ?? this.defaultMaxTokens,
    });

    const choice = response.choices[0]!;
    const content = choice.message.content ?? "";
    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      finishReason: this.mapFinishReason(choice.finish_reason),
    };
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private mapFinishReason(reason: string | null): LLMResponse["finishReason"] {
    switch (reason) {
      case "stop":
        return "stop";
      case "tool_calls":
        return "tool_calls";
      case "length":
        return "length";
      default:
        return "error";
    }
  }
}
