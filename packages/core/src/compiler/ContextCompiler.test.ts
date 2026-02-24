import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextCompiler } from "./ContextCompiler.js";
import { ResourceRegistry } from "../registry/ResourceRegistry.js";
import { TokenEstimator } from "./TokenEstimator.js";
import { BudgetScheduler } from "../budget/BudgetScheduler.js";
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "../types/resource.js";
import type { TraceWriter, TraceEvent } from "../types/trace.js";

function makeToolProvider(
  tools: Array<{ id: string; name: string; tags: string[]; description?: string }>,
): ResourceProvider {
  const l0: L0Index[] = tools.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description ?? `Tool ${t.name}`,
    type: "tool" as const,
    tags: t.tags,
    riskLevel: "low" as const,
  }));
  return {
    type: "tool",
    listL0: vi.fn().mockResolvedValue(l0),
    getL1: vi.fn().mockImplementation(
      async (id: string): Promise<L1Preview> => ({
        ...l0.find((r) => r.id === id)!,
        summary: `Summary for ${id}`,
        parameterSummary: "query (string)",
      }),
    ),
    getL2: vi.fn().mockResolvedValue({} as L2Payload),
  };
}

function makeTracer(): TraceWriter & { events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    write: vi.fn((e: TraceEvent) => events.push(e)),
    flush: vi.fn().mockResolvedValue(undefined),
  };
}

describe("ContextCompiler", () => {
  let registry: ResourceRegistry;
  let estimator: TokenEstimator;
  let budget: BudgetScheduler;
  let tracer: ReturnType<typeof makeTracer>;
  let compiler: ContextCompiler;

  beforeEach(() => {
    registry = new ResourceRegistry();
    estimator = new TokenEstimator();
    budget = new BudgetScheduler({
      maxTokensPerTask: 20_000,
      maxTokensPerTurn: 4_000,
      estimator,
    });
    tracer = makeTracer();
    compiler = new ContextCompiler({ registry, budget, estimator, tracer });
  });

  it("injects all L0 blocks always", async () => {
    registry.register(
      makeToolProvider([
        { id: "tool:web_search", name: "Web Search", tags: ["search"] },
        { id: "tool:file_read", name: "File Reader", tags: ["file"] },
      ]),
    );

    const result = await compiler.compile({
      userQuery: "unrelated query xyz123",
      conversationHistory: [],
      previouslyLoadedL1: new Set(),
      turnId: "turn-1",
    });

    const l0Blocks = result.blocks.filter((b) => b.level === "L0");
    expect(l0Blocks).toHaveLength(2);
  });

  it("scores keyword matches correctly", () => {
    const resource: L0Index = {
      id: "tool:web_search",
      name: "Web Search",
      description: "Search the web",
      type: "tool",
      tags: ["search", "web"],
    };
    const score = compiler.scoreRelevance(resource, "search the web", new Set());
    expect(score.score).toBeGreaterThan(0.3);
    expect(score.reasons.some((r) => /keyword/.test(r))).toBe(true);
  });

  it("applies sticky bonus for previously loaded L1", () => {
    const resource: L0Index = {
      id: "tool:web_search",
      name: "Web Search",
      description: "A tool",
      type: "tool",
      tags: ["search"],
    };
    const withoutSticky = compiler.scoreRelevance(resource, "unrelated query xyz", new Set());
    const withSticky = compiler.scoreRelevance(
      resource,
      "unrelated query xyz",
      new Set(["tool:web_search"]),
    );
    expect(withSticky.score).toBeGreaterThan(withoutSticky.score);
    expect(withSticky.reasons).toContain("sticky:prev-turn");
  });

  it("loads L1 for relevant resources", async () => {
    const provider = makeToolProvider([
      {
        id: "tool:web_search",
        name: "Web Search",
        tags: ["search", "web"],
        description: "Search the web",
      },
    ]);
    registry.register(provider);

    await compiler.compile({
      userQuery: "search the web for news",
      conversationHistory: [],
      previouslyLoadedL1: new Set(),
      turnId: "turn-1",
    });

    expect(provider.getL1).toHaveBeenCalledWith("tool:web_search");
  });

  it("emits RESOURCE_LOADED trace events for L0 and L1", async () => {
    registry.register(
      makeToolProvider([
        {
          id: "tool:web_search",
          name: "Web Search",
          tags: ["search", "web"],
          description: "Search the web",
        },
      ]),
    );

    await compiler.compile({
      userQuery: "search the web",
      conversationHistory: [],
      previouslyLoadedL1: new Set(),
      turnId: "turn-1",
    });

    const loadedEvents = tracer.events.filter((e) => e.type === "RESOURCE_LOADED");
    expect(loadedEvents.length).toBeGreaterThan(0);

    const l0Events = tracer.events.filter(
      (e) => e.type === "RESOURCE_LOADED" && e.level === "L0",
    );
    expect(l0Events.length).toBeGreaterThan(0);
  });

  it("prunes L1 blocks that exceed budget", async () => {
    const tightBudget = new BudgetScheduler({
      maxTokensPerTask: 200,
      maxTokensPerTurn: 200,
      estimator,
    });
    const tightCompiler = new ContextCompiler({
      registry,
      budget: tightBudget,
      estimator,
      tracer,
    });

    const manyTools = Array.from({ length: 10 }, (_, i) => ({
      id: `tool:search${i}`,
      name: `Search Tool ${i}`,
      tags: ["search", "web", "query"],
      description: "Search the internet for information using query terms",
    }));
    registry.register(makeToolProvider(manyTools));

    const result = await tightCompiler.compile({
      userQuery: "search for information on the web using queries",
      conversationHistory: [],
      previouslyLoadedL1: new Set(),
      turnId: "turn-1",
    });

    const l1Blocks = result.blocks.filter((b) => b.level === "L1");
    const l1Tokens = l1Blocks.reduce((sum, b) => sum + b.tokens, 0);
    const availBudget = tightBudget.allocateTurnBudget(800);
    expect(l1Tokens).toBeLessThanOrEqual(Math.max(0, availBudget));
  });

  it("system prompt contains PACE context header and end marker", async () => {
    registry.register(
      makeToolProvider([
        {
          id: "tool:web_search",
          name: "Web Search",
          tags: ["search", "web"],
          description: "Search the web",
        },
      ]),
    );

    const result = await compiler.compile({
      userQuery: "search the web",
      conversationHistory: [],
      previouslyLoadedL1: new Set(),
      turnId: "turn-1",
    });

    expect(result.systemPrompt).toContain("[PACE RUNTIME CONTEXT]");
    expect(result.systemPrompt).toContain("Available Resources (Index)");
    expect(result.systemPrompt).toContain("[END PACE CONTEXT]");
  });
});
