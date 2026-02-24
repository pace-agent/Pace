import type { L0Index, L1Preview } from "../types/resource.js";
import type { Message } from "../types/llm.js";
import type { TraceWriter } from "../types/trace.js";
import type { ResourceRegistry } from "../registry/ResourceRegistry.js";
import type { BudgetScheduler } from "../budget/BudgetScheduler.js";
import type { TokenEstimator } from "./TokenEstimator.js";
import type { ContextBlock, RelevanceScore, CompileResult } from "./types.js";

export interface ContextCompilerOptions {
  registry: ResourceRegistry;
  budget: BudgetScheduler;
  estimator: TokenEstimator;
  tracer: TraceWriter;
  stickyTurns?: number;
  l1RelevanceThreshold?: number;
  maxL1Candidates?: number;
}

const TOKENIZER_PATTERN = /[\s\-_.,!?;:()\[\]{}'"\/\\]+/;

// Common English function words that carry no domain signal
const STOP_WORDS = new Set([
  "the", "and", "for", "are", "not", "can", "has", "had", "was", "this",
  "that", "with", "from", "into", "them", "they", "have", "will", "your",
  "what", "when", "over", "just", "each", "more", "also", "than", "then",
  "were", "been", "some", "most", "only", "well", "such", "even", "back",
  "out", "its", "our", "you", "all", "but", "she", "his", "her", "him",
  "one", "two", "now", "any", "use", "how", "who", "new", "old", "day",
  "may", "get", "did", "let", "put", "say", "too", "see",
]);

function tokenize(text: string): string[] {
  return text
    .split(TOKENIZER_PATTERN)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t.toLowerCase()))
    .map((t) => t.toLowerCase());
}

function renderL0(resource: L0Index): string {
  const risk = resource.riskLevel ? ` | risk: ${resource.riskLevel}` : "";
  const tags = resource.tags.join(", ");
  return `- [${resource.type}] ${resource.id}: ${resource.name} — ${resource.description}\n  tags: ${tags}${risk}`;
}

export class ContextCompiler {
  private readonly registry: ResourceRegistry;
  private readonly budget: BudgetScheduler;
  private readonly estimator: TokenEstimator;
  private readonly tracer: TraceWriter;
  private readonly l1RelevanceThreshold: number;
  private readonly maxL1Candidates: number;

  constructor(options: ContextCompilerOptions) {
    this.registry = options.registry;
    this.budget = options.budget;
    this.estimator = options.estimator;
    this.tracer = options.tracer;
    this.l1RelevanceThreshold = options.l1RelevanceThreshold ?? 0.3;
    this.maxL1Candidates = options.maxL1Candidates ?? 5;
  }

  async compile(params: {
    userQuery: string;
    conversationHistory: Message[];
    previouslyLoadedL1: Set<string>;
    turnId: string;
    taskId?: string;
    turnNumber?: number;
    availableForReply?: number;
  }): Promise<CompileResult> {
    const {
      userQuery,
      previouslyLoadedL1,
      turnId,
      taskId,
      turnNumber = 1,
      availableForReply = 800,
    } = params;

    // Step 1: Calculate token budget
    const availableTokens = this.budget.allocateTurnBudget(availableForReply);

    // Step 2: Get all L0 resources
    const allL0 = await this.registry.listAllL0();

    // Step 3: Score relevance
    const scores = allL0.map((r) => this.scoreRelevance(r, userQuery, previouslyLoadedL1));

    // Step 4: Select L1 candidates (score >= threshold, top maxL1Candidates)
    const l1Candidates = allL0
      .map((r, i) => ({ resource: r, score: scores[i]! }))
      .filter(({ score }) => score.score >= this.l1RelevanceThreshold)
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, this.maxL1Candidates);

    // Step 5: Load L1 and write trace events
    const l1Blocks: ContextBlock[] = [];
    for (const { resource, score } of l1Candidates) {
      const l1 = await this.registry.getL1(resource.id);
      const content = this.renderL1(l1);
      const tokens = this.estimator.estimate(content);
      l1Blocks.push({
        resourceId: resource.id,
        level: "L1",
        content,
        tokens,
        relevanceScore: score.score,
      });
      this.tracer.write({
        type: "RESOURCE_LOADED",
        timestamp: Date.now(),
        resourceId: resource.id,
        level: "L1",
        tokens,
        taskId,
        turnId,
      });
    }

    // Step 6: Budget pruning — greedy by score descending
    const prunedL1: ContextBlock[] = [];
    let l1TokensUsed = 0;
    for (const block of [...l1Blocks].sort((a, b) => b.relevanceScore - a.relevanceScore)) {
      if (l1TokensUsed + block.tokens <= availableTokens) {
        prunedL1.push(block);
        l1TokensUsed += block.tokens;
      }
    }

    // Step 7: Build L0 blocks and write trace events
    const l0Blocks: ContextBlock[] = [];
    let l0TokensUsed = 0;
    for (let i = 0; i < allL0.length; i++) {
      const resource = allL0[i]!;
      const content = renderL0(resource);
      const tokens = this.estimator.estimate(content);
      l0TokensUsed += tokens;
      l0Blocks.push({
        resourceId: resource.id,
        level: "L0",
        content,
        tokens,
        relevanceScore: scores[i]!.score,
      });
      this.tracer.write({
        type: "RESOURCE_LOADED",
        timestamp: Date.now(),
        resourceId: resource.id,
        level: "L0",
        tokens,
        taskId,
        turnId,
      });
    }

    // Step 8: Assemble system prompt
    const systemPrompt = this.assembleSystemPrompt({
      allL0,
      l1Blocks: prunedL1,
      taskId,
      turnNumber,
      availableForReply,
    });

    // Step 9: Build load decisions
    const loadDecisions = [
      ...l0Blocks.map((b) => ({
        resourceId: b.resourceId,
        level: "L0" as const,
        reason: "always injected",
      })),
      ...prunedL1.map((b) => {
        const score = scores.find((s) => s.resourceId === b.resourceId);
        return {
          resourceId: b.resourceId,
          level: "L1" as const,
          reason: score?.reasons.join(", ") ?? "relevance",
        };
      }),
    ];

    return {
      blocks: [...l0Blocks, ...prunedL1],
      systemPrompt,
      tokenUsage: {
        l0Tokens: l0TokensUsed,
        l1Tokens: l1TokensUsed,
        totalContext: l0TokensUsed + l1TokensUsed,
        budgetRemaining: Math.max(0, availableTokens - l1TokensUsed),
      },
      loadDecisions,
    };
  }

  scoreRelevance(
    resource: L0Index,
    query: string,
    previouslyLoadedL1: Set<string>,
  ): RelevanceScore {
    const queryTokens = tokenize(query);
    const resourceText =
      `${resource.name} ${resource.tags.join(" ")} ${resource.description}`.toLowerCase();
    const resourceTokens = tokenize(resourceText);

    let keywordScore = 0;
    if (queryTokens.length > 0) {
      const matchCount = queryTokens.filter((qt) =>
        resourceTokens.some((rt) => rt.includes(qt) || qt.includes(rt)),
      ).length;
      // Normalize by capping at 3 so long queries don't dilute scores
      keywordScore = Math.min(1.0, matchCount / 3);
    }

    const isSticky = previouslyLoadedL1.has(resource.id);
    const stickyBonus = isSticky ? 0.4 : 0;
    const score = Math.min(1.0, keywordScore * 0.6 + stickyBonus);

    const reasons: string[] = [];
    if (keywordScore > 0) reasons.push(`keyword:${Math.round(keywordScore * 100)}%`);
    if (isSticky) reasons.push("sticky:prev-turn");

    return { resourceId: resource.id, score, reasons };
  }

  private renderL1(resource: L1Preview): string {
    const lines: string[] = [
      `### ${resource.name} (${resource.id})`,
      `Type: ${resource.type} | Risk: ${resource.riskLevel ?? "unspecified"}`,
      resource.summary,
    ];
    if (resource.parameterSummary) lines.push(`Parameters: ${resource.parameterSummary}`);
    if (resource.example) lines.push(`Example: ${resource.example}`);
    if (resource.constraints) lines.push(`Constraints: ${resource.constraints}`);
    return lines.join("\n");
  }

  private assembleSystemPrompt(params: {
    allL0: L0Index[];
    l1Blocks: ContextBlock[];
    taskId?: string;
    turnNumber: number;
    availableForReply: number;
  }): string {
    const { allL0, l1Blocks, taskId, turnNumber, availableForReply } = params;

    const header = [
      "[PACE RUNTIME CONTEXT]",
      `Task ID: ${taskId ?? "unset"} | Turn: ${turnNumber}`,
      `Token Budget: ${availableForReply} available for reply`,
      "",
      "---",
    ].join("\n");

    const tools = allL0.filter((r) => r.type === "tool");
    const memories = allL0.filter((r) => r.type === "memory");
    const others = allL0.filter((r) => r.type !== "tool" && r.type !== "memory");

    const indexLines: string[] = ["## Available Resources (Index)", ""];
    if (tools.length > 0) {
      indexLines.push("### Tools");
      indexLines.push(...tools.map(renderL0));
      indexLines.push("");
    }
    if (memories.length > 0) {
      indexLines.push("### Memory");
      indexLines.push(...memories.map(renderL0));
      indexLines.push("");
    }
    if (others.length > 0) {
      indexLines.push("### Other");
      indexLines.push(...others.map(renderL0));
      indexLines.push("");
    }

    const sections: string[] = [header, "", indexLines.join("\n")];

    if (l1Blocks.length > 0) {
      const detailLines = ["## Resource Details (Previews)", ""];
      for (const block of l1Blocks) {
        detailLines.push(block.content);
        detailLines.push("");
      }
      sections.push(detailLines.join("\n"));
    }

    sections.push("[END PACE CONTEXT]");
    return sections.join("\n") + "\n";
  }
}
