// @pace-agent/core — Public API

// Resource types
export type {
  ResourceType,
  ResourceLevel,
  RiskLevel,
  L0Index,
  L1Preview,
  L2Payload,
  ResourceProvider,
} from "./types/resource.js";

// Action types
export type {
  ActionDomain,
  ActionOperation,
  ActionScope,
  ActionContract,
} from "./types/action.js";

// Trace types
export type {
  TraceEventBase,
  LLMCallStartEvent,
  LLMCallEndEvent,
  ResourceLoadedEvent,
  ToolInvokedEvent,
  PolicyDecisionEvent,
  StopTriggeredEvent,
  CheckpointEvent,
  TraceEvent,
  TraceWriter,
} from "./types/trace.js";

// LLM types
export type {
  MessageRole,
  Message,
  ToolCall,
  LLMResponse,
  LLMToolDefinition,
  LLMAdapter,
} from "./types/llm.js";

// Security types
export type {
  SecurityCheckLevel,
  SecurityProfile,
  SecurityDecision,
  SecurityPolicy,
} from "./types/security.js";

// Termination types
export type {
  StopReason,
  ReflectOptions,
  FailureReport,
  TerminationPolicy,
  TerminationContext,
} from "./types/termination.js";

// Memory types
export type {
  MemoryPriority,
  MemoryEntry,
  MemoryProvider,
} from "./types/memory.js";

// Tool types
export type {
  ToolResult,
  ToolDefinition,
  ToolProvider,
} from "./types/tool.js";

// Config (values + types)
export { PaceConfigSchema, parsePaceConfig } from "./types/config.js";
export type { PaceConfig, PaceConfigInput } from "./types/config.js";

// Registry
export { ResourceRegistry } from "./registry/ResourceRegistry.js";

// Compiler
export { ContextCompiler } from "./compiler/ContextCompiler.js";
export { TokenEstimator } from "./compiler/TokenEstimator.js";
export type { ContextBlock, RelevanceScore, CompileResult } from "./compiler/types.js";

// Budget
export { BudgetScheduler } from "./budget/BudgetScheduler.js";
export type { BudgetSchedulerOptions } from "./budget/BudgetScheduler.js";

// Trace
export { JsonlTracer } from "./trace/JsonlTracer.js";
export type { JsonlTracerOptions } from "./trace/JsonlTracer.js";

// Runtime
export { PaceRuntime as Pace } from "./runtime/PaceRuntime.js";
export type { PaceRuntimeOptions, RunResult } from "./runtime/PaceRuntime.js";
