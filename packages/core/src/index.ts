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

// Task Completion types (v0.2)
export type {
  TaskCompletion,
  TaskCompletionResult,
  ExtendedStopReason,
  CompletionContext,
  CompletionCheckResult,
} from "./types/completion.js";

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
  RelevanceScoringEvent,
  TaskCompletionCheckEvent,
  TaskIterationEvent,
  TaskCompletionStopEvent,
  SandboxInitEvent,
  SandboxFileSyncEvent,
  SandboxMergeEndEvent,
  SandboxMergeErrorEvent,
  SandboxDiscardEvent,
  GuardrailLearnedEvent,
  GuardrailTriggeredEvent,
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
export type { ContextCompilerOptions } from "./compiler/ContextCompiler.js";
export { TokenEstimator } from "./compiler/TokenEstimator.js";
export type { ContextBlock, RelevanceScore, CompileResult } from "./compiler/types.js";

// Budget
export { BudgetScheduler } from "./budget/BudgetScheduler.js";
export type { BudgetSchedulerOptions } from "./budget/BudgetScheduler.js";

// Trace
export { JsonlTracer } from "./trace/JsonlTracer.js";
export type { JsonlTracerOptions } from "./trace/JsonlTracer.js";

// Completion (v0.2)
export { CompletionController } from "./completion/CompletionController.js";
export type { CompletionControllerOptions } from "./completion/CompletionController.js";

// Guardrails (v0.2 Phase 4)
export { GuardrailsManager } from "./guardrails/GuardrailsManager.js";
export type {
  GuardrailRule,
  FailureContext,
  ExecutionContext,
  GuardrailsManagerOptions,
} from "./guardrails/types.js";

// Tool Executor (v0.3)
export { ToolExecutor, type ToolExecutorOptions } from "./tools/ToolExecutor.js";
export { builtinTools } from "./tools/builtin.js";
export type {
  ToolDefinition as ExecutorToolDefinition,
  ToolCall,
  ToolResult as ExecutorToolResult,
  ToolHandler,
  ToolContext,
} from "./tools/types.js";

// Runtime
export { PaceRuntime as Pace } from "./runtime/PaceRuntime.js";
export type { PaceRuntimeOptions, RunResult } from "./runtime/PaceRuntime.js";
