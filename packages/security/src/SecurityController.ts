import type { SecurityPolicy, SecurityDecision, SecurityProfile, ActionContract } from "@pace-agent/core";
import type { RiskLevel } from "@pace-agent/core";

// Risk level ordering for comparisons
const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function riskGte(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

export interface SecurityControllerOptions {
  /** Predefined profile: "open" | "balanced" | "strict". Default: "balanced" */
  profile?: SecurityProfile;
  /** Override the auto-approve threshold. By default derived from profile. */
  autoApproveBelow?: RiskLevel;
}

/**
 * SecurityController — S0 rule engine with three built-in profiles.
 *
 * Evaluation order:
 *   1. S0 hard rules (always applied regardless of profile)
 *   2. Profile-level risk threshold
 */
export class SecurityController implements SecurityPolicy {
  readonly autoApproveBelow: RiskLevel;
  private readonly profile: SecurityProfile;

  constructor(options: SecurityControllerOptions = {}) {
    this.profile = options.profile ?? "balanced";
    this.autoApproveBelow = options.autoApproveBelow ?? this.deriveAutoApproveThreshold(this.profile);
  }

  async evaluate(contract: ActionContract): Promise<SecurityDecision> {
    // ── S0 hard rules ────────────────────────────────────────────────────────

    // Rule 1: Shell exec is always denied
    if (contract.domain === "shell" && contract.operation === "exec") {
      return {
        allowed: false,
        action: "deny",
        reason: "S0: Shell command execution is unconditionally denied",
        checkLevel: "S0",
      };
    }

    // Rule 2: Global-scope delete is always denied
    if (contract.operation === "delete" && contract.impact.scope === "global") {
      return {
        allowed: false,
        action: "deny",
        reason: "S0: Global-scope delete operations are unconditionally denied",
        checkLevel: "S0",
      };
    }

    // Rule 3: Critical risk level is always denied
    if (contract.riskLevel === "critical") {
      return {
        allowed: false,
        action: "deny",
        reason: "S0: Critical-risk actions are unconditionally denied",
        checkLevel: "S0",
      };
    }

    // Rule 4: Irreversible batch operations escalate to human approval
    if (!contract.reversible && contract.impact.scope === "batch") {
      return {
        allowed: false,
        action: "approve",
        reason: "S0: Irreversible batch operations require human approval",
        checkLevel: "S0",
      };
    }

    // ── Profile-level threshold ───────────────────────────────────────────────
    if (riskGte(contract.riskLevel, this.autoApproveBelow)) {
      // Risk meets or exceeds the auto-approve threshold → require approval
      return {
        allowed: false,
        action: this.profile === "strict" ? "deny" : "approve",
        reason: `Profile '${this.profile}': risk level '${contract.riskLevel}' requires ${this.profile === "strict" ? "denial" : "human approval"}`,
        checkLevel: "S0",
      };
    }

    // ── Auto-approved ─────────────────────────────────────────────────────────
    return {
      allowed: true,
      action: "allow",
      reason: `Profile '${this.profile}': risk level '${contract.riskLevel}' is auto-approved`,
      checkLevel: "S0",
    };
  }

  private deriveAutoApproveThreshold(profile: SecurityProfile): RiskLevel {
    switch (profile) {
      case "open":
        // Allow low + medium, require approval for high, deny critical (S0)
        return "high";
      case "balanced":
        // Allow low, require approval for medium+, deny critical (S0)
        return "medium";
      case "strict":
        // Allow nothing (even low requires approval ... but we auto-approve below "low")
        // Effectively: only truly risk-free operations auto-approved
        return "low";
    }
  }
}
