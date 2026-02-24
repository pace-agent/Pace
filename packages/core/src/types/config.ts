import { z } from "zod";
import type { SecurityProfile } from "./security.js";

// ---- Configuration Schema ----

/** Zod schema for Pace runtime configuration */
export const PaceConfigSchema = z.object({
  budget: z
    .object({
      maxTokensPerTask: z.number().positive().default(20_000),
      maxTokensPerTurn: z.number().positive().default(4_000),
    })
    .default({}),

  security: z
    .union([
      z.enum(["open", "balanced", "strict"]),
      z.custom<import("./security.js").SecurityPolicy>(),
    ])
    .default("balanced"),

  termination: z
    .object({
      maxRetries: z.number().nonnegative().default(2),
      maxStagnation: z.number().nonnegative().default(3),
      maxSecurityDenials: z.number().nonnegative().default(2),
    })
    .default({}),

  trace: z
    .object({
      output: z.string().default(".pace/traces/"),
      format: z.enum(["jsonl"]).default("jsonl"),
    })
    .default({}),

  scoring: z
    .object({
      /** "keyword": fast path (default). "llm": always use LLM. "auto": use LLM when candidateCount >= llmThresholdCandidates */
      mode: z.enum(["keyword", "llm", "auto"]).default("keyword"),
      /** Candidate threshold for "auto" mode to switch to LLM scoring */
      llmThresholdCandidates: z.number().positive().default(10),
      /** Max tokens for the scoring LLM call */
      scoringMaxTokens: z.number().positive().default(256),
    })
    .default({}),
});

/** Inferred TypeScript type from the Zod schema */
export type PaceConfig = z.infer<typeof PaceConfigSchema>;

/** Partial config for user input (all fields optional with defaults) */
export type PaceConfigInput = z.input<typeof PaceConfigSchema>;

/** Helper to validate and apply defaults */
export function parsePaceConfig(input: unknown): PaceConfig {
  return PaceConfigSchema.parse(input);
}

// Re-export for convenience
export type { SecurityProfile };
