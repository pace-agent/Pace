import { describe, it, expect } from "vitest";
import { SecurityController } from "./SecurityController.js";
import type { ActionContract } from "@pace-agent/core";

function makeContract(overrides: Partial<ActionContract> = {}): ActionContract {
  return {
    domain: "fs",
    operation: "read",
    target: "/tmp/file.txt",
    impact: { scope: "single" },
    reversible: true,
    riskLevel: "low",
    ...overrides,
  };
}

describe("SecurityController — S0 hard rules", () => {
  const ctrl = new SecurityController({ profile: "open" });

  it("denies shell exec unconditionally", async () => {
    const d = await ctrl.evaluate(makeContract({ domain: "shell", operation: "exec", riskLevel: "low" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("deny");
    expect(d.checkLevel).toBe("S0");
  });

  it("denies global-scope delete unconditionally", async () => {
    const d = await ctrl.evaluate(makeContract({ operation: "delete", impact: { scope: "global" }, riskLevel: "low" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("deny");
  });

  it("denies critical risk unconditionally", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "critical" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("deny");
  });

  it("escalates irreversible batch to approve", async () => {
    const d = await ctrl.evaluate(
      makeContract({ reversible: false, impact: { scope: "batch" }, riskLevel: "medium" }),
    );
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("approve");
  });
});

describe("SecurityController — profile: open", () => {
  const ctrl = new SecurityController({ profile: "open" });

  it("auto-approves low risk", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "low" }));
    expect(d.allowed).toBe(true);
    expect(d.action).toBe("allow");
  });

  it("auto-approves medium risk", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "medium" }));
    expect(d.allowed).toBe(true);
    expect(d.action).toBe("allow");
  });

  it("requires approval for high risk", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "high" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("approve");
  });
});

describe("SecurityController — profile: balanced", () => {
  const ctrl = new SecurityController({ profile: "balanced" });

  it("auto-approves low risk", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "low" }));
    expect(d.allowed).toBe(true);
  });

  it("requires approval for medium risk", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "medium" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("approve");
  });
});

describe("SecurityController — profile: strict", () => {
  const ctrl = new SecurityController({ profile: "strict" });

  it("denies medium risk (strict uses deny not approve)", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "medium" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("deny");
  });

  it("denies high risk", async () => {
    const d = await ctrl.evaluate(makeContract({ riskLevel: "high" }));
    expect(d.allowed).toBe(false);
    expect(d.action).toBe("deny");
  });

  it("autoApproveBelow is 'low' for strict profile", () => {
    expect(ctrl.autoApproveBelow).toBe("low");
  });
});
