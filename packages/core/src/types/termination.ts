// ---- Termination Types ----

/** Reasons for automatic stop */
export type StopReason = "budget" | "retry" | "stagnation" | "risk";

/** Options passed to the reflection phase after stop */
export interface ReflectOptions {
  /** What was the agent trying to do */
  task: string;
  /** What was accomplished so far */
  completedSteps: string[];
  /** Where did it get stuck */
  stuckAt: string;
  /** The stop reason */
  reason: StopReason;
}

/** Structured failure report generated on stop */
export interface FailureReport {
  reason: StopReason;
  trigger: string;
  summary: string;
  completedSteps: string[];
  stuckAt: string;
  nextOptions: string[];
  tokenUsage: {
    total: number;
    budget: number;
  };
}

/**
 * TerminationPolicy — pluggable policy for deciding when to stop.
 */
export interface TerminationPolicy {
  /** Check if the agent should stop, returning a reason or null to continue */
  shouldStop(context: TerminationContext): StopReason | null;
}

/** Context provided to termination policies for evaluation */
export interface TerminationContext {
  totalTokens: number;
  budgetTokens: number;
  consecutiveErrors: number;
  consecutiveStagnations: number;
  securityDenials: number;
}
