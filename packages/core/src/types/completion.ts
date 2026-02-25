// ---- Task Completion Types ----

/**
 * TaskCompletion — External verification mechanism.
 *
 * Solves the problem of LLM self-evaluation being unreliable.
 * Instead of trusting the LLM to decide when done, use external
 * verifiable criteria.
 */
export interface TaskCompletion {
  /**
   * Verify if the task is truly complete.
   *
   * This function should implement objective, externally verifiable checks.
   * Examples:
   * - File exists with correct content
   * - Tests pass
   * - API returns expected response
   * - Database has expected records
   *
   * @returns Object with `complete` flag and `reason` explaining the result
   */
  verifyCompletion(): Promise<TaskCompletionResult>;

  /**
   * Maximum number of iterations before forced stop.
   * One iteration = one turn (LLM call + tool executions).
   * Optional - if not set, no iteration limit.
   */
  maxIterations?: number;

  /**
   * Maximum total token consumption before forced stop.
   * Optional - if not set, no token limit is enforced by this controller.
   * Note: This is separate from PaceConfig.budget.maxTokensPerTask.
   */
  maxTokens?: number;

  /**
   * Maximum cost in USD before forced stop.
   * Optional - if not set, no cost limit.
   */
  maxCost?: number;

  /**
   * How often to check completion (in turns).
   * Default: 1 (check after every turn).
   * Must be a positive integer >= 1.
   * Set higher to reduce overhead if verification is expensive.
   */
  checkInterval?: number;
}

/**
 * Result of a completion verification check.
 */
export interface TaskCompletionResult {
  /** Whether the task is complete */
  complete: boolean;

  /** Human-readable explanation of the result */
  reason: string;

  /** Optional details for debugging/logging */
  details?: Record<string, unknown>;
}

/**
 * Extended stop reason including completion-based stops.
 */
export type ExtendedStopReason =
  | "budget"
  | "retry"
  | "stagnation"
  | "risk"
  | "completion" // Task verified complete
  | "max_iterations" // Exceeded maxIterations
  | "max_tokens" // Exceeded TaskCompletion.maxTokens
  | "max_cost"; // Exceeded TaskCompletion.maxCost

/**
 * Context for completion checking, extending TerminationContext.
 */
export interface CompletionContext {
  /** Current iteration number (1-indexed) */
  iteration: number;

  /** Total tokens consumed so far */
  totalTokens: number;

  /** Total cost in USD so far */
  totalCost: number;

  /** Number of turns completed */
  turnCount: number;
}

/**
 * Completion check result with stop decision.
 */
export interface CompletionCheckResult {
  /** Whether to stop the agent */
  shouldStop: boolean;

  /** Reason for stopping (if shouldStop is true) */
  stopReason?: ExtendedStopReason;

  /** The completion verification result */
  verification?: TaskCompletionResult;

  /** Current iteration */
  iteration: number;
}
