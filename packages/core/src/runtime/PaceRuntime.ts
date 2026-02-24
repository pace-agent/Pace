import type { LLMAdapter, Message, LLMResponse, LLMToolDefinition, ToolCall } from "../types/llm.js";
import type { ResourceProvider } from "../types/resource.js";
import type { TraceEvent, TraceWriter } from "../types/trace.js";
import type { PaceConfigInput } from "../types/config.js";
import type { SecurityPolicy, SecurityDecision } from "../types/security.js";
import type { TerminationPolicy, TerminationContext, StopReason } from "../types/termination.js";
import type { ToolProvider } from "../types/tool.js";
import type { ActionContract } from "../types/action.js";
import type { RiskLevel } from "../types/resource.js";
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
  /** Override the security policy (takes precedence over config.security) */
  securityPolicy?: SecurityPolicy;
  /** Override the termination policy */
  terminationPolicy?: TerminationPolicy;
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
  /** True if the run was halted early by the termination policy */
  stopped: boolean;
  /** Why it was stopped, if stopped=true */
  stopReason?: StopReason;
  /** Total number of tool calls executed across all loop iterations */
  toolCallsExecuted: number;
}

// ── Risk level ordering ───────────────────────────────────────────────────────

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function riskGte(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

// ── Inline security policy for string profiles ────────────────────────────────

function buildProfilePolicy(profile: "open" | "balanced" | "strict"): SecurityPolicy {
  const thresholds: Record<string, RiskLevel> = {
    open: "high",
    balanced: "medium",
    strict: "low",
  };
  const autoApproveBelow = thresholds[profile] as RiskLevel;

  return {
    autoApproveBelow,
    async evaluate(contract: ActionContract): Promise<SecurityDecision> {
      // S0 hard rules
      if (contract.domain === "shell" && contract.operation === "exec") {
        return { allowed: false, action: "deny", reason: "S0: Shell exec denied", checkLevel: "S0" };
      }
      if (contract.riskLevel === "critical") {
        return { allowed: false, action: "deny", reason: "S0: Critical risk denied", checkLevel: "S0" };
      }
      if (!contract.reversible && contract.impact.scope === "batch") {
        return {
          allowed: false,
          action: "approve",
          reason: "S0: Irreversible batch requires approval",
          checkLevel: "S0",
        };
      }
      if (contract.operation === "delete" && contract.impact.scope === "global") {
        return { allowed: false, action: "deny", reason: "S0: Global delete denied", checkLevel: "S0" };
      }
      // Profile threshold
      if (riskGte(contract.riskLevel, autoApproveBelow)) {
        return {
          allowed: false,
          action: profile === "strict" ? "deny" : "approve",
          reason: `Profile '${profile}': risk '${contract.riskLevel}' requires ${profile === "strict" ? "denial" : "approval"}`,
          checkLevel: "S0",
        };
      }
      return { allowed: true, action: "allow", reason: `Profile '${profile}': auto-approved`, checkLevel: "S0" };
    },
  };
}

// ── Inline default termination policy ────────────────────────────────────────

function buildDefaultTerminationPolicy(
  maxRetries: number,
  maxStagnation: number,
  maxSecurityDenials: number,
  budgetRatio = 0.95,
): TerminationPolicy {
  return {
    shouldStop(ctx: TerminationContext): StopReason | null {
      if (ctx.budgetTokens > 0 && ctx.totalTokens / ctx.budgetTokens >= budgetRatio) return "budget";
      if (ctx.consecutiveErrors >= maxRetries) return "retry";
      if (ctx.consecutiveStagnations >= maxStagnation) return "stagnation";
      if (ctx.securityDenials >= maxSecurityDenials) return "risk";
      return null;
    },
  };
}

// ── PaceRuntime ───────────────────────────────────────────────────────────────

export class PaceRuntime {
  readonly registry: ResourceRegistry;
  readonly tracer: TraceWriter;

  private readonly llm: LLMAdapter;
  private readonly config: ReturnType<typeof parsePaceConfig>;
  private readonly budget: BudgetScheduler;
  private readonly estimator: TokenEstimator;
  private readonly compiler: ContextCompiler;
  private readonly securityPolicy: SecurityPolicy;
  private readonly terminationPolicy: TerminationPolicy;
  private readonly allEvents: TraceEvent[] = [];

  /** ResourceProvider that also implements ToolProvider (detected via duck typing) */
  private readonly toolProvider: (ResourceProvider & ToolProvider) | null;

  private conversationHistory: Message[] = [];
  private previouslyLoadedL1 = new Set<string>();
  private turnCounter = 0;
  private readonly taskId = `task-${Date.now()}`;

  // Termination counters (reset per-task, not per-turn)
  private consecutiveErrors = 0;
  private consecutiveStagnations = 0;
  private securityDenials = 0;
  private previousReply = "";

  constructor(options: PaceRuntimeOptions) {
    this.llm = options.llm;
    this.config = parsePaceConfig(options.config ?? {});

    this.registry = new ResourceRegistry();
    let detectedToolProvider: (ResourceProvider & ToolProvider) | null = null;
    for (const provider of options.resources ?? []) {
      this.registry.register(provider);
      if (detectedToolProvider === null && "executeTool" in provider) {
        detectedToolProvider = provider as ResourceProvider & ToolProvider;
      }
    }
    this.toolProvider = detectedToolProvider;

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

    // Security policy: explicit override > config value
    if (options.securityPolicy) {
      this.securityPolicy = options.securityPolicy;
    } else {
      const cfgSecurity = this.config.security;
      this.securityPolicy =
        typeof cfgSecurity === "string"
          ? buildProfilePolicy(cfgSecurity)
          : (cfgSecurity as SecurityPolicy);
    }

    // Termination policy: explicit override > config value
    this.terminationPolicy =
      options.terminationPolicy ??
      buildDefaultTerminationPolicy(
        this.config.termination.maxRetries,
        this.config.termination.maxStagnation,
        this.config.termination.maxSecurityDenials,
      );
  }

  async run(userMessage: string): Promise<RunResult> {
    const turnId = `turn-${++this.turnCounter}`;
    const snapshotStart = this.allEvents.length;

    this.budget.resetTurn();

    // ── Step 1: Compile context ─────────────────────────────────────────────
    const compileResult = await this.compiler.compile({
      userQuery: userMessage,
      conversationHistory: this.conversationHistory,
      previouslyLoadedL1: this.previouslyLoadedL1,
      turnId,
      taskId: this.taskId,
      turnNumber: this.turnCounter,
      availableForReply: 800,
    });

    // ── Step 2: Gather tool definitions (if tool provider registered) ────────
    let llmTools: LLMToolDefinition[] | undefined;
    if (this.toolProvider) {
      const toolDefs = await this.toolProvider.listTools();
      llmTools = toolDefs.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    }

    // ── Step 3: Initial LLM call ─────────────────────────────────────────────
    const messages: Message[] = [
      { role: "system", content: compileResult.systemPrompt },
      ...this.conversationHistory,
      { role: "user", content: userMessage },
    ];

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

    let callStart = Date.now();
    let llmResponse = await this.llm.chat({
      messages,
      tools: llmTools,
      maxTokens: this.budget.getTurnBudget().remaining,
    });
    this.tracer.write({
      type: "LLM_CALL_END",
      timestamp: Date.now(),
      taskId: this.taskId,
      turnId,
      tokens: { input: llmResponse.usage.inputTokens, output: llmResponse.usage.outputTokens },
      latencyMs: Date.now() - callStart,
    });
    this.budget.recordUsage(llmResponse.usage);

    // Track stagnation against previous reply
    if (llmResponse.content && llmResponse.content === this.previousReply) {
      this.consecutiveStagnations++;
    } else if (llmResponse.content) {
      this.consecutiveStagnations = 0;
    }

    let toolCallsExecuted = 0;

    // ── Step 4: Agentic tool execution loop ──────────────────────────────────
    while (llmResponse.finishReason === "tool_calls" && llmResponse.toolCalls?.length) {
      // ── 4a. Termination check ─────────────────────────────────────────────
      const terminationCtx: TerminationContext = {
        totalTokens: this.budget.getTaskUsage().used,
        budgetTokens: this.budget.getTaskUsage().budget,
        consecutiveErrors: this.consecutiveErrors,
        consecutiveStagnations: this.consecutiveStagnations,
        securityDenials: this.securityDenials,
      };
      const stopReason = this.terminationPolicy.shouldStop(terminationCtx);
      if (stopReason) {
        return this.buildStopResult({
          stopReason,
          messages,
          llmResponse,
          snapshotStart,
          compileResult,
          toolCallsExecuted,
        });
      }

      // ── 4b. Inject assistant message (with tool calls) into messages ───────
      messages.push({
        role: "assistant",
        content: llmResponse.content,
        toolCalls: llmResponse.toolCalls,
      });

      // ── 4c. Execute each tool call ─────────────────────────────────────────
      for (const toolCall of llmResponse.toolCalls) {
        const toolResult = await this.executeToolCall(toolCall, turnId);
        if (toolResult.executed) toolCallsExecuted++;
        messages.push({
          role: "tool",
          content: toolResult.content,
          toolCallId: toolCall.id,
        });
      }

      // ── 4d. Termination check after tool results ──────────────────────────
      const stopAfter = this.terminationPolicy.shouldStop({
        totalTokens: this.budget.getTaskUsage().used,
        budgetTokens: this.budget.getTaskUsage().budget,
        consecutiveErrors: this.consecutiveErrors,
        consecutiveStagnations: this.consecutiveStagnations,
        securityDenials: this.securityDenials,
      });
      if (stopAfter) {
        return this.buildStopResult({
          stopReason: stopAfter,
          messages,
          llmResponse,
          snapshotStart,
          compileResult,
          toolCallsExecuted,
        });
      }

      // ── 4e. Next LLM call with accumulated messages ────────────────────────
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

      callStart = Date.now();
      llmResponse = await this.llm.chat({
        messages,
        tools: llmTools,
        maxTokens: this.budget.getTurnBudget().remaining,
      });
      this.tracer.write({
        type: "LLM_CALL_END",
        timestamp: Date.now(),
        taskId: this.taskId,
        turnId,
        tokens: { input: llmResponse.usage.inputTokens, output: llmResponse.usage.outputTokens },
        latencyMs: Date.now() - callStart,
      });
      this.budget.recordUsage(llmResponse.usage);

      // Stagnation check
      if (llmResponse.content && llmResponse.content === this.previousReply) {
        this.consecutiveStagnations++;
      } else if (llmResponse.content) {
        this.consecutiveStagnations = 0;
      }
    }

    // ── Step 5: Finalize ─────────────────────────────────────────────────────
    messages.push({ role: "assistant", content: llmResponse.content });
    this.previousReply = llmResponse.content;

    // Update conversation history (skip the system message at index 0)
    this.conversationHistory = messages.slice(1);

    this.previouslyLoadedL1 = new Set(
      compileResult.blocks.filter((b) => b.level === "L1").map((b) => b.resourceId),
    );

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
      stopped: false,
      toolCallsExecuted,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async executeToolCall(
    toolCall: ToolCall,
    turnId: string,
  ): Promise<{ content: string; executed: boolean }> {
    if (!this.toolProvider) {
      this.consecutiveErrors++;
      return { content: "Error: No tool provider configured", executed: false };
    }

    // Security check
    const toolDef = await this.toolProvider.getTool(toolCall.name);
    if (toolDef?.actionContract) {
      const contract: ActionContract = {
        ...toolDef.actionContract,
        target: toolCall.name,
        impact: { scope: "single" },
      };
      const decision = await this.securityPolicy.evaluate(contract);

      this.tracer.write({
        type: "POLICY_DECISION",
        timestamp: Date.now(),
        taskId: this.taskId,
        turnId,
        action: toolCall.name,
        decision: decision.action,
        reason: decision.reason,
      });

      if (!decision.allowed) {
        this.securityDenials++;
        return { content: `Security policy ${decision.action}: ${decision.reason}`, executed: false };
      }
    }

    // Parse arguments
    let params: unknown;
    try {
      params = JSON.parse(toolCall.arguments);
    } catch {
      params = {};
    }

    // Execute
    const toolStart = Date.now();
    try {
      const result = await this.toolProvider.executeTool(toolCall.name, params);
      const latencyMs = Date.now() - toolStart;

      this.tracer.write({
        type: "TOOL_INVOKED",
        timestamp: Date.now(),
        taskId: this.taskId,
        turnId,
        toolName: toolCall.name,
        success: result.success,
        latencyMs,
      });

      if (result.success) {
        this.consecutiveErrors = 0;
      } else {
        this.consecutiveErrors++;
      }

      return {
        content: result.success
          ? JSON.stringify(result.output ?? "")
          : `Tool error: ${result.error ?? "unknown error"}`,
        executed: result.success,
      };
    } catch (err) {
      const latencyMs = Date.now() - toolStart;
      this.tracer.write({
        type: "TOOL_INVOKED",
        timestamp: Date.now(),
        taskId: this.taskId,
        turnId,
        toolName: toolCall.name,
        success: false,
        latencyMs,
      });
      this.consecutiveErrors++;
      return { content: `Tool threw: ${String(err)}`, executed: false };
    }
  }

  private buildStopResult(params: {
    stopReason: StopReason;
    messages: Message[];
    llmResponse: LLMResponse;
    snapshotStart: number;
    compileResult: { tokenUsage: { totalContext: number }; blocks: Array<{ level: string; resourceId: string }> };
    toolCallsExecuted: number;
  }): RunResult {
    const { stopReason, messages, llmResponse, snapshotStart, compileResult, toolCallsExecuted } = params;

    this.tracer.write({
      type: "STOP_TRIGGERED",
      timestamp: Date.now(),
      taskId: this.taskId,
      reason: stopReason,
      trigger: `consecutiveErrors=${this.consecutiveErrors} stagnations=${this.consecutiveStagnations} denials=${this.securityDenials}`,
    });

    // Still persist conversation history up to this point
    this.conversationHistory = messages.slice(1);
    this.previouslyLoadedL1 = new Set(
      compileResult.blocks.filter((b) => b.level === "L1").map((b) => b.resourceId),
    );

    void this.tracer.flush();

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
      stopped: true,
      stopReason,
      toolCallsExecuted,
    };
  }
}
