// ---- Resource Types ----

/** All resource types supported by Pace */
export type ResourceType = "tool" | "memory" | "skill" | "document";

/** Three-layer progressive disclosure levels */
export type ResourceLevel = "L0" | "L1" | "L2";

/** Risk level for resources and actions */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/**
 * L0 Index — lightweight directory entry (~20-50 tokens).
 * Always injected into context by default.
 */
export interface L0Index {
  id: string;
  name: string;
  description: string;
  type: ResourceType;
  tags: string[];
  riskLevel?: RiskLevel;
  cost?: number;
}

/**
 * L1 Preview — expanded summary (~100-300 tokens).
 * Loaded when the LLM or ContextCompiler judges relevance.
 */
export interface L1Preview extends L0Index {
  summary: string;
  parameterSummary?: string;
  example?: string;
  constraints?: string;
}

/**
 * L2 Payload — full content (~500-5000 tokens).
 * Loaded only when actually needed (tool invocation, full text reference).
 */
export interface L2Payload extends L1Preview {
  fullContent: string;
  schema?: Record<string, unknown>;
}

/**
 * ResourceProvider — pluggable source of resources.
 * Each provider manages one resource type and exposes L0/L1/L2 accessors.
 */
export interface ResourceProvider {
  readonly type: ResourceType;

  /** Return all resources at L0 index level */
  listL0(): Promise<L0Index[]>;

  /** Return a single resource at L1 preview level */
  getL1(id: string): Promise<L1Preview>;

  /** Return a single resource at L2 full payload level */
  getL2(id: string): Promise<L2Payload>;
}
