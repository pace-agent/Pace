import type { RiskLevel } from "./resource.js";

// ---- Action Contract ----

/** Domains of side-effectful operations */
export type ActionDomain = "fs" | "git" | "db" | "net" | "shell" | "custom";

/** Operation verbs */
export type ActionOperation = "read" | "write" | "delete" | "exec";

/** Scope of impact */
export type ActionScope = "single" | "batch" | "global";

/**
 * ActionContract — structured declaration of a side-effectful operation.
 * Every tool with side effects must produce an ActionContract before execution.
 */
export interface ActionContract {
  domain: ActionDomain;
  operation: ActionOperation;
  target: string;
  impact: {
    scope: ActionScope;
    estimate?: string;
  };
  reversible: boolean;
  riskLevel: RiskLevel;
}
