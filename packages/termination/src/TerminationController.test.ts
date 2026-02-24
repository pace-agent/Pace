import { describe, it, expect } from "vitest";
import { TerminationController } from "./TerminationController.js";

const base = {
  totalTokens: 0,
  budgetTokens: 10_000,
  consecutiveErrors: 0,
  consecutiveStagnations: 0,
  securityDenials: 0,
};

describe("TerminationController", () => {
  it("returns null when everything is within limits", () => {
    const ctrl = new TerminationController();
    expect(ctrl.shouldStop({ ...base, totalTokens: 5_000 })).toBeNull();
  });

  it("returns 'budget' when token ratio >= threshold", () => {
    const ctrl = new TerminationController({ budgetThreshold: 0.9 });
    expect(ctrl.shouldStop({ ...base, totalTokens: 9_000 })).toBe("budget");
    expect(ctrl.shouldStop({ ...base, totalTokens: 8_999 })).toBeNull();
  });

  it("returns 'retry' when consecutiveErrors >= maxRetries", () => {
    const ctrl = new TerminationController({ maxRetries: 3 });
    expect(ctrl.shouldStop({ ...base, consecutiveErrors: 3 })).toBe("retry");
    expect(ctrl.shouldStop({ ...base, consecutiveErrors: 2 })).toBeNull();
  });

  it("returns 'stagnation' when consecutiveStagnations >= maxStagnations", () => {
    const ctrl = new TerminationController({ maxStagnations: 3 });
    expect(ctrl.shouldStop({ ...base, consecutiveStagnations: 3 })).toBe("stagnation");
    expect(ctrl.shouldStop({ ...base, consecutiveStagnations: 2 })).toBeNull();
  });

  it("returns 'risk' when securityDenials >= maxRiskDenials", () => {
    const ctrl = new TerminationController({ maxRiskDenials: 2 });
    expect(ctrl.shouldStop({ ...base, securityDenials: 2 })).toBe("risk");
    expect(ctrl.shouldStop({ ...base, securityDenials: 1 })).toBeNull();
  });

  it("budget check takes priority over retry", () => {
    const ctrl = new TerminationController({ budgetThreshold: 0.5, maxRetries: 1 });
    const result = ctrl.shouldStop({
      ...base,
      totalTokens: 6_000, // 60% > 50% threshold
      consecutiveErrors: 5, // also exceeds maxRetries
    });
    expect(result).toBe("budget");
  });

  it("buildFailureReport returns structured report", () => {
    const ctrl = new TerminationController();
    const report = ctrl.buildFailureReport({
      reason: "retry",
      task: "fetch user data",
      completedSteps: ["step 1"],
      stuckAt: "calling db_query",
      tokenUsage: { total: 3_000, budget: 10_000 },
    });
    expect(report.reason).toBe("retry");
    expect(report.completedSteps).toEqual(["step 1"]);
    expect(report.stuckAt).toBe("calling db_query");
    expect(report.nextOptions.length).toBeGreaterThan(0);
    expect(report.tokenUsage).toEqual({ total: 3_000, budget: 10_000 });
  });

  it("buildFailureReport trigger message references threshold for budget reason", () => {
    const ctrl = new TerminationController();
    const report = ctrl.buildFailureReport({
      reason: "budget",
      task: "analyze code",
      completedSteps: [],
      stuckAt: "loading resources",
      tokenUsage: { total: 9_500, budget: 10_000 },
    });
    expect(report.trigger).toMatch(/95%/);
  });
});
