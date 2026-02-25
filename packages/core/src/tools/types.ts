// ---- Tool Execution Types ----

/**
 * Tool definition for LLM function calling.
 */
export interface ToolDefinition {
  /** Tool name (unique identifier) */
  name: string;

  /** Tool description for LLM */
  description: string;

  /** JSON Schema for parameters */
  parameters: {
    type: "object";
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };

  /** Risk level for security assessment */
  riskLevel?: "low" | "medium" | "high" | "critical";
}

/**
 * Tool call from LLM response.
 */
export interface ToolCall {
  /** Unique ID for this tool call */
  id: string;

  /** Tool name */
  name: string;

  /** Parsed parameters */
  params: Record<string, unknown>;
}

/**
 * Tool execution context.
 */
export interface ToolContext {
  /** Working directory for file operations */
  cwd: string;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Tool execution result.
 */
export interface ToolResult {
  /** Tool call ID this result corresponds to */
  toolCallId: string;

  /** Tool name */
  toolName: string;

  /** Result content (string or JSON) */
  content: string;

  /** Whether execution succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Execution latency in milliseconds */
  latencyMs: number;
}

/**
 * Tool handler function type.
 */
export type ToolHandler = (
  params: Record<string, unknown>,
  context: ToolContext
) => Promise<unknown>;

/**
 * Tool entry in registry.
 */
export interface ToolEntry {
  definition: ToolDefinition;
  handler: ToolHandler;
}
