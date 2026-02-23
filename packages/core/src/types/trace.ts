import type { ResourceLevel } from "./resource.js";

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

/** Union of all trace event types */
export type TraceEvent =
  | LLMCallStartEvent
  | LLMCallEndEvent
  | ResourceLoadedEvent
  | ToolInvokedEvent
  | PolicyDecisionEvent
  | StopTriggeredEvent
  | CheckpointEvent;

/**
 * TraceWriter — interface for recording trace events.
 */
export interface TraceWriter {
  write(event: TraceEvent): void;
  flush(): Promise<void>;
}
