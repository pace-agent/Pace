import type {
  TerminationPolicy,
  TerminationContext,
  StopReason,
  FailureReport,
} from "@pace-agent/core";

export interface TerminationControllerOptions {
  /** Token budget ratio at which to stop (0–1). Default: 0.95 */
  budgetThreshold?: number;
  /** Max consecutive tool errors before stopping. Default: 3 */
  maxRetries?: number;
  /** Max consecutive turns with identical reply before stopping. Default: 3 */
  maxStagnations?: number;
  /** Max security denials before stopping. Default: 2 */
  maxRiskDenials?: number;
}

/**
 * TerminationController — stateless policy implementation.
 *
 * `shouldStop()` is pure: it reads context and returns a reason or null.
 * All counters are maintained by the caller (PaceRuntime).
 */
export class TerminationController implements TerminationPolicy {
  private readonly budgetThreshold: number;
  private readonly maxRetries: number;
  private readonly maxStagnations: number;
  private readonly maxRiskDenials: number;

  constructor(options: TerminationControllerOptions = {}) {
    this.budgetThreshold = options.budgetThreshold ?? 0.95;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxStagnations = options.maxStagnations ?? 3;
    this.maxRiskDenials = options.maxRiskDenials ?? 2;
  }

  shouldStop(context: TerminationContext): StopReason | null {
    const { totalTokens, budgetTokens, consecutiveErrors, consecutiveStagnations, securityDenials } = context;

    // 1. Budget exhaustion — check first (hard constraint)
    if (budgetTokens > 0 && totalTokens / budgetTokens >= this.budgetThreshold) {
      return "budget";
    }

    // 2. Too many consecutive errors
    if (consecutiveErrors >= this.maxRetries) {
      return "retry";
    }

    // 3. Stagnation — LLM keeps producing identical outputs
    if (consecutiveStagnations >= this.maxStagnations) {
      return "stagnation";
    }

    // 4. Too many security denials
    if (securityDenials >= this.maxRiskDenials) {
      return "risk";
    }

    return null;
  }

  /**
   * Build a structured failure report for display / logging.
   * PaceRuntime passes in the high-level task context.
   */
  buildFailureReport(params: {
    reason: StopReason;
    task: string;
    completedSteps: string[];
    stuckAt: string;
    tokenUsage: { total: number; budget: number };
  }): FailureReport {
    const { reason, task, completedSteps, stuckAt, tokenUsage } = params;

    const triggerMap: Record<StopReason, string> = {
      budget: `Token usage reached ${Math.round((tokenUsage.total / tokenUsage.budget) * 100)}% of budget`,
      retry: `Exceeded ${this.maxRetries} consecutive tool errors`,
      stagnation: `Agent produced identical output ${this.maxStagnations} consecutive turns`,
      risk: `Security policy denied ${this.maxRiskDenials} consecutive actions`,
    };

    const summaryMap: Record<StopReason, string> = {
      budget: `The agent ran out of token budget while working on: ${task}`,
      retry: `The agent repeatedly failed the same tool call and cannot recover automatically`,
      stagnation: `The agent is stuck in a loop generating identical responses`,
      risk: `The agent attempted too many high-risk operations and was stopped for safety`,
    };

    const nextOptionsMap: Record<StopReason, string[]> = {
      budget: [
        "Increase maxTokensPerTask in the Pace config",
        "Break the task into smaller sub-tasks",
        "Reduce the number of registered resources to lower L0 overhead",
      ],
      retry: [
        "Check that the required tool is available and configured correctly",
        "Provide more specific instructions to guide tool parameter selection",
        "Review tool error logs for root cause",
      ],
      stagnation: [
        "Rephrase the user query with more specific guidance",
        "Check if the LLM model has enough capability for this task",
        "Add more relevant resources so the agent has better context",
      ],
      risk: [
        "Review the security profile — consider switching from 'strict' to 'balanced'",
        "Explicitly allow the required action in the security policy",
        "Break the task into steps so each step's risk can be evaluated individually",
      ],
    };

    return {
      reason,
      trigger: triggerMap[reason],
      summary: summaryMap[reason],
      completedSteps,
      stuckAt,
      nextOptions: nextOptionsMap[reason],
      tokenUsage,
    };
  }
}
