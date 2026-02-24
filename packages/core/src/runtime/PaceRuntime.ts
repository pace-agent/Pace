import type { LLMAdapter, Message, LLMResponse } from "../types/llm.js";
import type { ResourceProvider } from "../types/resource.js";
import type { TraceEvent, TraceWriter } from "../types/trace.js";
import type { PaceConfigInput } from "../types/config.js";
import { parsePaceConfig } from "../types/config.js";
import { ResourceRegistry } from "../registry/ResourceRegistry.js";
import { TokenEstimator } from "../compiler/TokenEstimator.js";
import { BudgetScheduler } from "../budget/BudgetScheduler.js";
import { ContextCompiler } from "../compiler/ContextCompiler.js";
import { JsonlTracer } from "../trace/JsonlTracer.js";

export interface PaceRuntimeOptions {
  llm: LLMAdapter;
  resources?: ResourceProvider[];
  config?: PaceConfigInput;
  tracer?: TraceWriter;
}

export interface RunResult {
  reply: string;
  trace: TraceEvent[];
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    contextTokens: number;
    totalTokens: number;
  };
  finishReason: LLMResponse["finishReason"];
}

export class PaceRuntime {
  readonly registry: ResourceRegistry;
  readonly tracer: TraceWriter;

  private readonly llm: LLMAdapter;
  private readonly config: ReturnType<typeof parsePaceConfig>;
  private readonly budget: BudgetScheduler;
  private readonly estimator: TokenEstimator;
  private readonly compiler: ContextCompiler;
  private readonly allEvents: TraceEvent[] = [];

  private conversationHistory: Message[] = [];
  private previouslyLoadedL1 = new Set<string>();
  private turnCounter = 0;
  private readonly taskId = `task-${Date.now()}`;

  constructor(options: PaceRuntimeOptions) {
    this.llm = options.llm;
    this.config = parsePaceConfig(options.config ?? {});

    this.registry = new ResourceRegistry();
    for (const provider of options.resources ?? []) {
      this.registry.register(provider);
    }

    this.estimator = new TokenEstimator();
    this.budget = new BudgetScheduler({
      maxTokensPerTask: this.config.budget.maxTokensPerTask,
      maxTokensPerTurn: this.config.budget.maxTokensPerTurn,
      estimator: this.estimator,
    });

    const baseTracer =
      options.tracer ??
      new JsonlTracer({
        outputDir: this.config.trace.output,
        taskId: this.taskId,
      });

    const allEvents = this.allEvents;
    this.tracer = {
      write: (event: TraceEvent) => {
        allEvents.push(event);
        baseTracer.write(event);
      },
      flush: () => baseTracer.flush(),
    };

    this.compiler = new ContextCompiler({
      registry: this.registry,
      budget: this.budget,
      estimator: this.estimator,
      tracer: this.tracer,
    });
  }

  async run(userMessage: string): Promise<RunResult> {
    const turnId = `turn-${++this.turnCounter}`;
    const snapshotStart = this.allEvents.length;

    this.budget.resetTurn();

    const compileResult = await this.compiler.compile({
      userQuery: userMessage,
      conversationHistory: this.conversationHistory,
      previouslyLoadedL1: this.previouslyLoadedL1,
      turnId,
      taskId: this.taskId,
      turnNumber: this.turnCounter,
      availableForReply: 800,
    });

    this.tracer.write({
      type: "LLM_CALL_START",
      timestamp: Date.now(),
      taskId: this.taskId,
      turnId,
      tokens: {
        context: compileResult.tokenUsage.totalContext,
        budget: this.budget.getTurnBudget().remaining,
      },
    });

    const messages: Message[] = [
      { role: "system", content: compileResult.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: userMessage },
    ];

    const callStart = Date.now();
    const llmResponse = await this.llm.chat({
      messages,
      maxTokens: this.budget.getTurnBudget().remaining,
    });
    const latencyMs = Date.now() - callStart;

    this.tracer.write({
      type: "LLM_CALL_END",
      timestamp: Date.now(),
      taskId: this.taskId,
      turnId,
      tokens: {
        input: llmResponse.usage.inputTokens,
        output: llmResponse.usage.outputTokens,
      },
      latencyMs,
    });

    this.budget.recordUsage(llmResponse.usage);

    this.conversationHistory.push({ role: "user", content: userMessage });
    this.conversationHistory.push({ role: "assistant", content: llmResponse.content });

    this.previouslyLoadedL1 = new Set(
      compileResult.blocks.filter((b) => b.level === "L1").map((b) => b.resourceId),
    );

    if (llmResponse.finishReason === "tool_calls") {
      console.warn(
        "[PaceRuntime] finishReason=tool_calls received but Phase 1 has no tool execution loop",
      );
    }

    await this.tracer.flush();

    return {
      reply: llmResponse.content,
      trace: this.allEvents.slice(snapshotStart),
      tokenUsage: {
        inputTokens: llmResponse.usage.inputTokens,
        outputTokens: llmResponse.usage.outputTokens,
        contextTokens: compileResult.tokenUsage.totalContext,
        totalTokens: llmResponse.usage.inputTokens + llmResponse.usage.outputTokens,
      },
      finishReason: llmResponse.finishReason,
    };
  }
}
