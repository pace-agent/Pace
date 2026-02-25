import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolHandler,
  ToolContext,
  ToolEntry,
} from "./types.js";
import type { TraceWriter, TraceEvent } from "../types/trace.js";

/**
 * ToolExecutorOptions — Options for creating a ToolExecutor.
 */
export interface ToolExecutorOptions {
  /** Working directory for file operations */
  cwd?: string;

  /** Trace writer for events */
  traceWriter?: TraceWriter;
}

/**
 * ToolExecutor — Executes tools and manages tool registry.
 *
 * This class implements the tool execution mechanism for the Agent Loop.
 * It maintains a registry of available tools and executes them when called.
 *
 * Key features:
 * - Register custom tools with handlers
 * - Execute tool calls from LLM responses
 * - Built-in tools for common operations
 * - Trace events for observability
 *
 * @example
 * ```typescript
 * const executor = new ToolExecutor({ cwd: process.cwd() });
 *
 * // Register custom tool
 * executor.register({
 *   name: 'my_tool',
 *   description: 'Does something',
 *   parameters: {
 *     type: 'object',
 *     properties: { input: { type: 'string' } },
 *     required: ['input'],
 *   },
 * }, async (params, ctx) => {
 *   return { result: `Processed: ${params.input}` };
 * });
 *
 * // Execute tool call
 * const result = await executor.execute({
 *   id: 'call_123',
 *   name: 'my_tool',
 *   params: { input: 'hello' },
 * });
 * ```
 */
export class ToolExecutor {
  private readonly cwd: string;
  private readonly traceWriter?: TraceWriter;
  private readonly tools: Map<string, ToolEntry> = new Map();

  constructor(options: ToolExecutorOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.traceWriter = options.traceWriter;
  }

  /**
   * Register a new tool.
   *
   * @param definition - Tool definition for LLM
   * @param handler - Handler function to execute the tool
   */
  register(definition: ToolDefinition, handler: ToolHandler): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }

    this.tools.set(definition.name, {
      definition,
      handler,
    });
  }

  /**
   * Unregister a tool.
   *
   * @param name - Tool name to unregister
   */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /**
   * Get all registered tool definitions for LLM.
   *
   * @returns Array of tool definitions
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((entry) => entry.definition);
  }

  /**
   * Check if a tool is registered.
   *
   * @param name - Tool name
   * @returns Whether the tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool call.
   *
   * @param toolCall - The tool call from LLM
   * @returns Execution result
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const startTime = Date.now();

    const entry = this.tools.get(toolCall.name);
    if (!entry) {
      const result: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: "",
        success: false,
        error: `Unknown tool: ${toolCall.name}`,
        latencyMs: Date.now() - startTime,
      };

      this.emitTraceEvent({
        type: "TOOL_EXECUTION" as any,
        timestamp: Date.now(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: result.error,
        latencyMs: result.latencyMs,
      });

      return result;
    }

    const context: ToolContext = {
      cwd: this.cwd,
    };

    try {
      const result = await entry.handler(toolCall.params, context);
      const latencyMs = Date.now() - startTime;

      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: this.serializeResult(result),
        success: true,
        latencyMs,
      };

      this.emitTraceEvent({
        type: "TOOL_EXECUTION" as any,
        timestamp: Date.now(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: true,
        latencyMs,
      });

      return toolResult;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      const toolResult: ToolResult = {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: "",
        success: false,
        error: errorMessage,
        latencyMs,
      };

      this.emitTraceEvent({
        type: "TOOL_EXECUTION" as any,
        timestamp: Date.now(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        success: false,
        error: errorMessage,
        latencyMs,
      });

      return toolResult;
    }
  }

  /**
   * Execute multiple tool calls in parallel.
   *
   * @param toolCalls - Array of tool calls
   * @returns Array of results (same order as input)
   */
  async executeBatch(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((call) => this.execute(call)));
  }

  // ---- Private Helper Methods ----

  private serializeResult(result: unknown): string {
    if (typeof result === "string") {
      return result;
    }

    if (result === undefined || result === null) {
      return "";
    }

    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  private emitTraceEvent(event: TraceEvent): void {
    this.traceWriter?.write(event);
  }
}
