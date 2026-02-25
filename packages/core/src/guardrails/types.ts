// ---- Guardrails Types ----

import type { TraceEventBase } from "../types/trace.js";

/**
 * Guardrail Rule — learned from failures.
 */
export interface GuardrailRule {
  /** Unique rule ID */
  id: string;

  /** Human-readable description */
  description: string;

  /** Trigger conditions */
  trigger: {
    /** Regex pattern to match error messages */
    errorPattern?: string;
    /** Specific tool name that failed */
    toolName?: string;
    /** Number of consecutive failures before triggering */
    failureCount?: number;
  };

  /** Suggested action to take */
  suggestion: string;

  /** When this rule was created */
  createdAt: number;

  /** How many times this rule has been triggered */
  hitCount: number;

  /** Whether this rule is active */
  active: boolean;
}

/**
 * Context when a failure occurs.
 */
export interface FailureContext {
  /** Tool that failed (if applicable) */
  tool?: string;

  /** Error message */
  error: string;

  /** Context at time of failure */
  context: string;

  /** User feedback (if provided) */
  userFeedback?: string;

  /** Timestamp of failure */
  timestamp: number;

  /** Turn number when failure occurred */
  turnNumber?: number;
}

/**
 * Execution context for checking triggers.
 */
export interface ExecutionContext {
  /** Current tool being executed (if any) */
  currentTool?: string;

  /** Recent error messages */
  recentErrors: string[];

  /** Consecutive failure count */
  consecutiveFailures: number;

  /** Current turn number */
  turnNumber: number;
}

/**
 * Guardrails Manager Options.
 */
export interface GuardrailsManagerOptions {
  /** Directory to store rules (default: .pace/guardrails) */
  storageDir?: string;

  /** Maximum number of rules to keep */
  maxRules?: number;

  /** Callback when a new rule is learned */
  onRuleLearned?: (rule: GuardrailRule) => void;

  /** Callback when a rule is triggered */
  onRuleTriggered?: (rule: GuardrailRule, context: ExecutionContext) => void;
}

// ---- Trace Events ----

export interface GuardrailLearnedEvent extends TraceEventBase {
  type: "GUARDRAIL_LEARNED";
  rule: {
    id: string;
    description: string;
    suggestion: string;
  };
}

export interface GuardrailTriggeredEvent extends TraceEventBase {
  type: "GUARDRAIL_TRIGGERED";
  rule: {
    id: string;
    description: string;
    suggestion: string;
  };
  context: {
    currentTool?: string;
    consecutiveFailures: number;
    turnNumber: number;
  };
}
