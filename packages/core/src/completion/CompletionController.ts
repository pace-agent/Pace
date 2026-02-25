import type {
  TaskCompletion,
  TaskCompletionResult,
  CompletionContext,
  CompletionCheckResult,
  ExtendedStopReason,
} from "../types/completion.js";
import type { TraceWriter, TaskCompletionCheckEvent, TaskIterationEvent } from "../types/trace.js";

/**
 * CompletionControllerOptions — configuration for the controller.
 */
export interface CompletionControllerOptions {
  /** The task completion definition */
  taskCompletion: TaskCompletion;

  /** Trace writer for events */
  traceWriter?: TraceWriter;

  /** Callback when completion is achieved */
  onCompletion?: (result: TaskCompletionResult, iteration: number) => void;

  /** Callback when limits are exceeded */
  onLimitExceeded?: (reason: ExtendedStopReason, context: CompletionContext) => void;
}

/**
 * CompletionController — manages external task verification.
 *
 * This controller implements the external verification mechanism from v0.2 design.
 * It periodically checks if the task is complete using user-provided criteria,
 * and enforces iteration/token/cost limits.
 *
 * Key features:
 * - External verification via TaskCompletion.verifyCompletion()
 * - Iteration counting and limits
 * - Token and cost tracking
 * - Configurable check interval
 *
 * @example
 * ```typescript
 * const controller = new CompletionController({
 *   taskCompletion: {
 *     verifyCompletion: async () => {
 *       const exists = await fileExists('output.txt');
 *       return {
 *         complete: exists,
 *         reason: exists ? 'Output file created' : 'Output file not found',
 *       };
 *     },
 *     maxIterations: 50,
 *   },
 * });
 *
 * // After each turn:
 * const result = await controller.check({
 *   iteration: 1,
 *   totalTokens: 1000,
 *   totalCost: 0.01,
 *   turnCount: 1,
 * });
 *
 * if (result.shouldStop) {
 *   console.log('Stopping:', result.stopReason);
 * }
 * ```
 */
export class CompletionController {
  private readonly taskCompletion: TaskCompletion;
  private readonly traceWriter?: TraceWriter;
  private readonly onCompletion?: (result: TaskCompletionResult, iteration: number) => void;
  private readonly onLimitExceeded?: (reason: ExtendedStopReason, context: CompletionContext) => void;

  /** Current iteration count */
  private currentIteration: number = 0;

  /** Total tokens consumed */
  private totalTokensConsumed: number = 0;

  /** Total cost in USD */
  private totalCostConsumed: number = 0;

  /** Total turns completed */
  private totalTurns: number = 0;

  constructor(options: CompletionControllerOptions) {
    this.taskCompletion = options.taskCompletion;
    this.traceWriter = options.traceWriter;
    this.onCompletion = options.onCompletion;
    this.onLimitExceeded = options.onLimitExceeded;

    // Validate checkInterval
    this.validateConfig();
  }

  /**
   * Validate task completion configuration.
   * Throws an error if configuration is invalid.
   */
  private validateConfig(): void {
    const { checkInterval, maxIterations, maxTokens, maxCost } = this.taskCompletion;

    if (checkInterval !== undefined) {
      if (!Number.isInteger(checkInterval) || checkInterval < 1) {
        throw new Error(
          `TaskCompletion.checkInterval must be a positive integer >= 1, got: ${checkInterval}`
        );
      }
    }

    if (maxIterations !== undefined && maxIterations < 1) {
      throw new Error(
        `TaskCompletion.maxIterations must be a positive integer, got: ${maxIterations}`
      );
    }

    if (maxTokens !== undefined && maxTokens < 1) {
      throw new Error(
        `TaskCompletion.maxTokens must be a positive number, got: ${maxTokens}`
      );
    }

    if (maxCost !== undefined && maxCost < 0) {
      throw new Error(
        `TaskCompletion.maxCost must be a non-negative number, got: ${maxCost}`
      );
    }
  }

  /**
   * Check if the task is complete or limits are exceeded.
   *
   * This method should be called after each turn. It:
   * 1. Increments iteration count
   * 2. Checks token/cost limits
   * 3. Checks iteration limit
   * 4. Calls verifyCompletion if at check interval
   *
   * @param context Current execution context
   * @returns Result indicating whether to stop and why
   */
  async check(context: CompletionContext): Promise<CompletionCheckResult> {
    this.currentIteration = context.iteration;
    this.totalTokensConsumed = context.totalTokens;
    this.totalCostConsumed = context.totalCost;
    this.totalTurns = context.turnCount;

    // Emit iteration event
    this.emitIterationEvent();

    // 1. Check token limit
    if (this.taskCompletion.maxTokens !== undefined) {
      if (context.totalTokens >= this.taskCompletion.maxTokens) {
        const reason: ExtendedStopReason = "max_tokens";
        this.onLimitExceeded?.(reason, context);
        return {
          shouldStop: true,
          stopReason: reason,
          iteration: context.iteration,
        };
      }
    }

    // 2. Check cost limit
    if (this.taskCompletion.maxCost !== undefined) {
      if (context.totalCost >= this.taskCompletion.maxCost) {
        const reason: ExtendedStopReason = "max_cost";
        this.onLimitExceeded?.(reason, context);
        return {
          shouldStop: true,
          stopReason: reason,
          iteration: context.iteration,
        };
      }
    }

    // 3. Check iteration limit
    if (this.taskCompletion.maxIterations !== undefined) {
      if (context.iteration >= this.taskCompletion.maxIterations) {
        const reason: ExtendedStopReason = "max_iterations";
        this.onLimitExceeded?.(reason, context);
        return {
          shouldStop: true,
          stopReason: reason,
          iteration: context.iteration,
        };
      }
    }

    // 4. Check completion at interval
    const checkInterval = this.taskCompletion.checkInterval ?? 1;
    if (context.iteration % checkInterval === 0) {
      const result = await this.verifyCompletion();

      if (result.complete) {
        this.onCompletion?.(result, context.iteration);
        return {
          shouldStop: true,
          stopReason: "completion",
          verification: result,
          iteration: context.iteration,
        };
      }

      return {
        shouldStop: false,
        verification: result,
        iteration: context.iteration,
      };
    }

    // Not at check interval, continue
    return {
      shouldStop: false,
      iteration: context.iteration,
    };
  }

  /**
   * Call the user's verifyCompletion function with error handling.
   */
  private async verifyCompletion(): Promise<TaskCompletionResult> {
    const startTime = Date.now();

    try {
      const result = await this.taskCompletion.verifyCompletion();

      const latencyMs = Date.now() - startTime;

      // Emit trace event
      this.emitCompletionCheckEvent(result, latencyMs);

      return result;
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // On error, return incomplete with error message
      const errorResult: TaskCompletionResult = {
        complete: false,
        reason: `Verification error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          error: true,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      };

      this.emitCompletionCheckEvent(errorResult, latencyMs);

      return errorResult;
    }
  }

  /**
   * Emit a completion check trace event.
   */
  private emitCompletionCheckEvent(result: TaskCompletionResult, latencyMs: number): void {
    if (!this.traceWriter) return;

    const event: TaskCompletionCheckEvent = {
      type: "TASK_COMPLETION_CHECK",
      timestamp: Date.now(),
      result,
      iteration: this.currentIteration,
      latencyMs,
    };

    this.traceWriter.write(event);
  }

  /**
   * Emit an iteration trace event.
   */
  private emitIterationEvent(): void {
    if (!this.traceWriter) return;

    const event: TaskIterationEvent = {
      type: "TASK_ITERATION",
      timestamp: Date.now(),
      iteration: this.currentIteration,
      maxIterations: this.taskCompletion.maxIterations,
      totalTokens: this.totalTokensConsumed,
      totalCost: this.totalCostConsumed,
    };

    this.traceWriter.write(event);
  }

  /**
   * Get current iteration count.
   */
  getIteration(): number {
    return this.currentIteration;
  }

  /**
   * Get total tokens consumed.
   */
  getTotalTokens(): number {
    return this.totalTokensConsumed;
  }

  /**
   * Get total cost consumed.
   */
  getTotalCost(): number {
    return this.totalCostConsumed;
  }

  /**
   * Reset state for a new task.
   */
  reset(): void {
    this.currentIteration = 0;
    this.totalTokensConsumed = 0;
    this.totalCostConsumed = 0;
    this.totalTurns = 0;
  }
}
