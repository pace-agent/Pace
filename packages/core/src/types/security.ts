import type { ActionContract } from "./action.js";
import type { RiskLevel } from "./resource.js";

// ---- Security Types ----

/** Security check levels */
export type SecurityCheckLevel = "S0" | "S1" | "S2";

/** Predefined security profiles */
export type SecurityProfile = "open" | "balanced" | "strict";

/** Result of a security policy evaluation */
export interface SecurityDecision {
  allowed: boolean;
  action: "allow" | "deny" | "approve";
  reason: string;
  checkLevel: SecurityCheckLevel;
}

/**
 * SecurityPolicy — pluggable policy for evaluating action contracts.
 */
export interface SecurityPolicy {
  /** Evaluate an action contract and return a security decision */
  evaluate(contract: ActionContract): Promise<SecurityDecision>;

  /** Get the risk threshold for auto-approval */
  readonly autoApproveBelow: RiskLevel;
}
