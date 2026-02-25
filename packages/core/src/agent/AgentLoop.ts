import type { Message, LLMAdapter, LLMResponse } from "../types/llm.js";
import type { ToolExecutor } from "../tools/ToolExecutor.js";
import type { ToolCall, ToolResult } from "../tools/types.js";
import type { TraceWriter, TraceEvent } from "../types/trace.js";
import type {
  AgentLoopOptions,
  AgentContext,
  AgentResult,
  LLMResponseWithTools,
} from "./types.js";

/**
 * AgentLoop — Implements the ReAct (Reasoning + Acting) loop.
 *
 * This class implements the core agent loop:
 * 1. Compile context with tools
 * 2. Call LLM
 * 3. If tool calls: execute tools, add results to context, repeat
 * 4. If no tool calls: return final response
 *
 * @example
 * ```typescript
 * const loop = new AgentLoop(llm, executor, {
 *   maxIterations: 20,
 *   onToolCall: (tool, params) => console.log(`Calling ${tool}`),
 * });
 *
 * const result = await loop.run([
 *   { role: 'user', content: 'Read the README.md file' }
 * ]);
 *
 * console.log(result.response);
 * ```
 */
export class AgentLoop {
  private readonly llm: LLMAdapter;
  private readonly executor: ToolExecutor;
  private readonly options: AgentLoopOptions;
  private readonly traceWriter?: TraceWriter;

  constructor(
    llm: LLMAdapter,
    executor: ToolExecutor,
    options: AgentLoopOptions = {},
    traceWriter?: TraceWriter
  ) {
    this.llm = llm;
    this.executor = executor;
    this.options = {
      maxIterations: 50,
      maxTokens: 100000,
      ...options,
    };
    this.traceWriter = traceWriter;
  }

  /**
   * Run the agent loop.
   *
   * @param messages - Initial messages (usually user query)
   * @returns Agent result with final response and tool calls
   */
  async run(messages: Message[]): Promise<AgentResult> {
    const context: AgentContext = {
      messages: [...messages],
      toolResults: [],
      iteration: 0,
      tokens: { input: 0, output: 0, total: 0 },
      shouldStop: false,
    };

    const allToolCalls: AgentResult["toolCalls"] = [];

    try {
      while (!context.shouldStop && context.iteration < (this.options.maxIterations ?? 50)) {
        context.iteration++;

        // Check token limit
        if (context.tokens.total >= (this.options.maxTokens ?? 100000)) {
          context.shouldStop = true;
          context.stopReason = "max_tokens";
          break;
        }

        // Call LLM
        this.emitTrace({
          type: "AGENT_ITERATION_START",
          timestamp: Date.now(),
          iteration: context.iteration,
        } as any);

        const response = await this.callLLM(context.messages);
        context.tokens.input += response.usage?.inputTokens ?? 0;
        context.tokens.output += response.usage?.outputTokens ?? 0;
        context.tokens.total = context.tokens.input + context.tokens.output;

        this.options.onResponse?.(response);

        // Check for tool calls
        const toolCalls = this.extractToolCalls(response);

        if (toolCalls.length === 0) {
          // No tool calls - we're done
          context.shouldStop = true;
          context.stopReason = "completed";
          return {
            response: response.content,
            toolCalls: allToolCalls,
            iterations: context.iteration,
            tokens: context.tokens,
            success: true,
            stopReason: "completed",
          };
        }

        // Execute tool calls
        const results = await this.executeTools(toolCalls);

        // Record tool calls
        for (let i = 0; i < toolCalls.length; i++) {
          const call = toolCalls[i];
          const result = results[i];
          allToolCalls.push({
            id: call.id,
            tool: call.name,
            params: call.params,
            result: result.success ? result.content : (result.error ?? "Unknown error"),
            success: result.success,
          });
        }

        // Add assistant message with tool calls
        context.messages.push({
          role: "assistant",
          content: response.content,
          toolCalls: toolCalls.map((c) => ({
            id: c.id,
            name: c.name,
            params: c.params,
          })),
        });

        // Add tool results
        for (const result of results) {
          context.messages.push({
            role: "tool",
            content: result.content,
            toolCallId: result.toolCallId,
          });
        }

        context.toolResults.push(...results);

        this.options.onIteration?.(context.iteration, context);
      }

      // Max iterations reached
      return {
        response: context.messages[context.messages.length - 1]?.content ?? "",
        toolCalls: allToolCalls,
        iterations: context.iteration,
        tokens: context.tokens,
        success: false,
        stopReason: context.stopReason ?? "max_iterations",
      };
    } catch (error) {
      this.options.onError?.(error as Error, context.iteration);
      return {
        response: "",
        toolCalls: allToolCalls,
        iterations: context.iteration,
        tokens: context.tokens,
        success: false,
        stopReason: `error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Call LLM with current context.
   */
  private async callLLM(messages: Message[]): Promise<LLMResponse> {
    const tools = this.executor.getDefinitions();

    const response = await this.llm.chat({
      messages,
      tools,
      maxTokens: 4096,
    });

    return response;
  }

  /**
   * Extract tool calls from LLM response.
   */
  private extractToolCalls(response: LLMResponse): ToolCall[] {
    // Check if response has tool calls in the expected format
    const anyResponse = response as any;

    if (anyResponse.toolCalls && Array.isArray(anyResponse.toolCalls)) {
      return anyResponse.toolCalls;
    }

    // Check for OpenAI-style tool_calls
    if (anyResponse.tool_calls && Array.isArray(anyResponse.tool_calls)) {
      return anyResponse.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name ?? tc.name,
        params: JSON.parse(tc.function?.arguments ?? tc.params ?? "{}"),
      }));
    }

    return [];
  }

  /**
   * Execute tool calls.
   */
  private async executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      await this.options.onToolCall?.(call.name, call.params);

      const result = await this.executor.execute(call);
      results.push(result);

      this.emitTrace({
        type: "TOOL_EXECUTION",
        timestamp: Date.now(),
        toolCallId: call.id,
        toolName: call.name,
        success: result.success,
        error: result.error,
        latencyMs: result.latencyMs,
      } as any);
    }

    return results;
  }

  /**
   * Emit trace event.
   */
  private emitTrace(event: TraceEvent): void {
    this.traceWriter?.write(event);
  }
}
