import type { ActionContract } from "./action.js";
import type { RiskLevel } from "./resource.js";

// ---- Tool Types ----

/** Result of a tool execution */
export interface ToolResult {
  success: boolean;
  output: unknown;
  error?: string;
  latencyMs: number;
}

/** Definition used to register a tool with Pace */
export interface ToolDefinition<TParams = unknown> {
  name: string;
  description: string;
  tags: string[];
  risk: RiskLevel;

  /** L1 preview: human-readable parameter summary */
  preview: string;

  /** L2 payload: full JSON schema for parameters */
  parameters: Record<string, unknown>;

  /** The actual execution function */
  execute: (params: TParams) => Promise<unknown>;

  /** Optional action contract for tools with side effects */
  actionContract?: Omit<ActionContract, "target" | "impact">;
}

/**
 * ToolProvider — ResourceProvider specialized for tools.
 */
export interface ToolProvider {
  /** List all tools at L0 index level */
  listTools(): Promise<ToolDefinition[]>;

  /** Get a tool definition by name */
  getTool(name: string): Promise<ToolDefinition | undefined>;

  /** Execute a tool and return the result */
  executeTool(name: string, params: unknown): Promise<ToolResult>;
}
