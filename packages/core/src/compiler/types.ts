import type { ResourceLevel } from "../types/resource.js";

export interface ContextBlock {
  resourceId: string;
  level: ResourceLevel;
  content: string;
  tokens: number;
  relevanceScore: number;
}

export interface RelevanceScore {
  resourceId: string;
  score: number;
  reasons: string[];
}

export interface CompileResult {
  blocks: ContextBlock[];
  systemPrompt: string;
  tokenUsage: {
    l0Tokens: number;
    l1Tokens: number;
    totalContext: number;
    budgetRemaining: number;
  };
  loadDecisions: Array<{ resourceId: string; level: ResourceLevel; reason: string }>;
}
