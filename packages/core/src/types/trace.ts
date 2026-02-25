import type { ResourceLevel } from "./resource.js";
import type { TaskCompletionResult, ExtendedStopReason } from "./completion.js";

// ---- Trace Events ----

/** Base fields shared by all trace events */
export interface TraceEventBase {
  timestamp: number;
  taskId?: string;
  turnId?: string;
}

export interface LLMCallStartEvent extends TraceEventBase {
  type: "LLM_CALL_START";
  tokens: { context: number; budget: number };
}

export interface LLMCallEndEvent extends TraceEventBase {
  type: "LLM_CALL_END";
  tokens: { input: number; output: number };
  latencyMs: number;
}

export interface ResourceLoadedEvent extends TraceEventBase {
  type: "RESOURCE_LOADED";
  resourceId: string;
  level: ResourceLevel;
  tokens: number;
}

export interface ToolInvokedEvent extends TraceEventBase {
  type: "TOOL_INVOKED";
  toolName: string;
  success: boolean;
  latencyMs: number;
}

export interface PolicyDecisionEvent extends TraceEventBase {
  type: "POLICY_DECISION";
  action: string;
  decision: "allow" | "deny" | "approve";
  reason: string;
}

export interface StopTriggeredEvent extends TraceEventBase {
  type: "STOP_TRIGGERED";
  reason: string;
  trigger: string;
}

export interface CheckpointEvent extends TraceEventBase {
  type: "CHECKPOINT";
  summary: string;
  progress: number;
}

export interface RelevanceScoringEvent extends TraceEventBase {
  type: "RELEVANCE_SCORING";
  /** Actual scoring mode used */
  mode: "llm" | "keyword";
  /** Number of L0 resources that were scored */
  candidateCount: number;
  /** Number of resources that met the threshold for L1 promotion */
  selectedCount: number;
  latencyMs: number;
  /** True when LLM scoring failed and keyword fallback was used */
  fallbackUsed?: boolean;
}

// ---- Task Completion Events ----

export interface TaskCompletionCheckEvent extends TraceEventBase {
  type: "TASK_COMPLETION_CHECK";
  /** The verification result */
  result: TaskCompletionResult;
  /** Current iteration number */
  iteration: number;
  /** Time taken to verify (ms) */
  latencyMs: number;
}

export interface TaskIterationEvent extends TraceEventBase {
  type: "TASK_ITERATION";
  /** Current iteration number (1-indexed) */
  iteration: number;
  /** Maximum iterations if set */
  maxIterations?: number;
  /** Tokens consumed so far */
  totalTokens: number;
  /** Cost so far in USD */
  totalCost: number;
}

export interface TaskCompletionStopEvent extends TraceEventBase {
  type: "TASK_COMPLETION_STOP";
  /** Why we stopped */
  reason: ExtendedStopReason;
  /** Final verification result (if stopped due to completion) */
  verification?: TaskCompletionResult;
  /** Total iterations completed */
  totalIterations: number;
}

/** Union of all trace event types */
export type TraceEvent =
  | LLMCallStartEvent
  | LLMCallEndEvent
  | ResourceLoadedEvent
  | ToolInvokedEvent
  | PolicyDecisionEvent
  | StopTriggeredEvent
  | CheckpointEvent
  | RelevanceScoringEvent
  | TaskCompletionCheckEvent
  | TaskIterationEvent
  | TaskCompletionStopEvent;

/**
 * TraceWriter — interface for recording trace events.
 */
export interface TraceWriter {
  write(event: TraceEvent): void;
  flush(): Promise<void>;
}
