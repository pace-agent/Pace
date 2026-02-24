import type { TokenEstimator } from "../compiler/TokenEstimator.js";

export interface BudgetSchedulerOptions {
  maxTokensPerTask: number;
  maxTokensPerTurn: number;
  estimator: TokenEstimator;
}

export class BudgetScheduler {
  private taskUsed = 0;
  private turnUsed = 0;
  private readonly maxTokensPerTask: number;
  private readonly maxTokensPerTurn: number;

  constructor(options: BudgetSchedulerOptions) {
    this.maxTokensPerTask = options.maxTokensPerTask;
    this.maxTokensPerTurn = options.maxTokensPerTurn;
  }

  allocateTurnBudget(reservedForReply = 800): number {
    const turnAvailable = this.maxTokensPerTurn - this.turnUsed - reservedForReply;
    const taskAvailable = this.maxTokensPerTask - this.taskUsed - reservedForReply;
    return Math.max(0, Math.min(turnAvailable, taskAvailable));
  }

  recordUsage(usage: { inputTokens: number; outputTokens: number }): void {
    const total = usage.inputTokens + usage.outputTokens;
    this.taskUsed += total;
    this.turnUsed += total;
  }

  isTaskBudgetExhausted(): boolean {
    return this.taskUsed >= this.maxTokensPerTask;
  }

  getTaskUsage(): { used: number; budget: number; remaining: number } {
    return {
      used: this.taskUsed,
      budget: this.maxTokensPerTask,
      remaining: Math.max(0, this.maxTokensPerTask - this.taskUsed),
    };
  }

  getTurnBudget(): { used: number; budget: number; remaining: number } {
    return {
      used: this.turnUsed,
      budget: this.maxTokensPerTurn,
      remaining: Math.max(0, this.maxTokensPerTurn - this.turnUsed),
    };
  }

  resetTurn(): void {
    this.turnUsed = 0;
  }
}
