import { describe, it, expect, beforeEach } from "vitest";
import { BudgetScheduler } from "./BudgetScheduler.js";
import { TokenEstimator } from "../compiler/TokenEstimator.js";

describe("BudgetScheduler", () => {
  let estimator: TokenEstimator;
  let scheduler: BudgetScheduler;

  beforeEach(() => {
    estimator = new TokenEstimator();
    scheduler = new BudgetScheduler({
      maxTokensPerTask: 10_000,
      maxTokensPerTurn: 2_000,
      estimator,
    });
  });

  it("allocates turn budget minus reserve", () => {
    const budget = scheduler.allocateTurnBudget(500);
    expect(budget).toBe(2_000 - 500);
  });

  it("returns task remaining if smaller than turn budget", () => {
    const small = new BudgetScheduler({
      maxTokensPerTask: 600,
      maxTokensPerTurn: 2_000,
      estimator,
    });
    expect(small.allocateTurnBudget(500)).toBe(600 - 500);
  });

  it("records usage and tracks across calls", () => {
    scheduler.recordUsage({ inputTokens: 500, outputTokens: 200 });
    expect(scheduler.getTaskUsage().used).toBe(700);
    expect(scheduler.getTurnBudget().used).toBe(700);
  });

  it("resetTurn resets turn usage but not task usage", () => {
    scheduler.recordUsage({ inputTokens: 500, outputTokens: 200 });
    scheduler.resetTurn();
    expect(scheduler.getTurnBudget().used).toBe(0);
    expect(scheduler.getTaskUsage().used).toBe(700);
  });

  it("detects task budget exhaustion", () => {
    scheduler.recordUsage({ inputTokens: 9_000, outputTokens: 1_001 });
    expect(scheduler.isTaskBudgetExhausted()).toBe(true);
  });

  it("does not exhaust for usage under limit", () => {
    scheduler.recordUsage({ inputTokens: 5_000, outputTokens: 2_000 });
    expect(scheduler.isTaskBudgetExhausted()).toBe(false);
  });

  it("never returns negative budget", () => {
    scheduler.recordUsage({ inputTokens: 9_000, outputTokens: 999 });
    expect(scheduler.allocateTurnBudget(800)).toBeGreaterThanOrEqual(0);
  });
});
