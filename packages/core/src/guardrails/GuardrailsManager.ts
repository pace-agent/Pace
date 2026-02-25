import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type {
  GuardrailRule,
  FailureContext,
  ExecutionContext,
  GuardrailsManagerOptions,
} from "./types.js";
import type { TraceWriter, TraceEvent } from "../types/trace.js";

/**
 * GuardrailsManager — Learns from failures and provides suggestions.
 *
 * This class implements the Guardrails mechanism from v0.2 design.
 * It captures failure patterns and generates rules to avoid repeating
 * the same mistakes in future iterations.
 *
 * Key features:
 * - Learn rules from failure contexts
 * - Store rules persistently
 * - Check if rules should be triggered
 * - Provide suggestions when rules trigger
 *
 * @example
 * ```typescript
 * const guardrails = new GuardrailsManager({
 *   storageDir: '.pace/guardrails',
 *   onRuleLearned: (rule) => console.log('New rule:', rule.description),
 * });
 *
 * await guardrails.initialize();
 *
 * // When a failure occurs
 * await guardrails.learnFromFailure({
 *   tool: 'execute_shell',
 *   error: 'Command not found: npm',
 *   context: 'Trying to run npm install',
 *   timestamp: Date.now(),
 * });
 *
 * // Check before execution
 * const rule = await guardrails.checkTrigger({
 *   currentTool: 'execute_shell',
 *   recentErrors: [],
 *   consecutiveFailures: 0,
 *   turnNumber: 1,
 * });
 * ```
 */
export class GuardrailsManager {
  private readonly storageDir: string;
  private readonly maxRules: number;
  private readonly onRuleLearned?: (rule: GuardrailRule) => void;
  private readonly onRuleTriggered?: (rule: GuardrailRule, context: ExecutionContext) => void;
  private readonly traceWriter?: TraceWriter;

  /** In-memory cache of rules */
  private rules: Map<string, GuardrailRule> = new Map();

  /** Whether the manager has been initialized */
  private initialized: boolean = false;

  constructor(options: GuardrailsManagerOptions = {}, traceWriter?: TraceWriter) {
    this.storageDir = options.storageDir ?? ".pace/guardrails";
    this.maxRules = options.maxRules ?? 100;
    this.onRuleLearned = options.onRuleLearned;
    this.onRuleTriggered = options.onRuleTriggered;
    this.traceWriter = traceWriter;
  }

  /**
   * Initialize the manager and load existing rules.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create storage directory
    await mkdir(this.storageDir, { recursive: true });

    // Load existing rules
    await this.loadRules();

    this.initialized = true;
  }

  /**
   * Learn a new rule from a failure context.
   */
  async learnFromFailure(failure: FailureContext): Promise<GuardrailRule> {
    await this.ensureInitialized();

    // Generate rule from failure
    const rule = this.generateRule(failure);

    // Check if similar rule already exists
    const existingRule = this.findSimilarRule(rule);
    if (existingRule) {
      existingRule.hitCount++;
      await this.saveRule(existingRule);
      return existingRule;
    }

    // Add new rule
    this.rules.set(rule.id, rule);
    await this.saveRule(rule);

    // Emit trace event
    this.emitTraceEvent({
      type: "GUARDRAIL_LEARNED",
      timestamp: Date.now(),
      rule: {
        id: rule.id,
        description: rule.description,
        suggestion: rule.suggestion,
      },
    });

    // Callback
    this.onRuleLearned?.(rule);

    return rule;
  }

  /**
   * Get all rules.
   */
  async getRules(activeOnly: boolean = false): Promise<GuardrailRule[]> {
    await this.ensureInitialized();

    const rules = Array.from(this.rules.values());

    if (activeOnly) {
      return rules.filter((r) => r.active);
    }

    return rules;
  }

  /**
   * Check if any rule should be triggered.
   */
  async checkTrigger(context: ExecutionContext): Promise<GuardrailRule | null> {
    await this.ensureInitialized();

    for (const rule of this.rules.values()) {
      if (!rule.active) {
        continue;
      }

      if (this.matchesTrigger(rule, context)) {
        rule.hitCount++;
        await this.saveRule(rule);

        // Emit trace event
        this.emitTraceEvent({
          type: "GUARDRAIL_TRIGGERED",
          timestamp: Date.now(),
          rule: {
            id: rule.id,
            description: rule.description,
            suggestion: rule.suggestion,
          },
          context: {
            currentTool: context.currentTool,
            consecutiveFailures: context.consecutiveFailures,
            turnNumber: context.turnNumber,
          },
        });

        // Callback
        this.onRuleTriggered?.(rule, context);

        return rule;
      }
    }

    return null;
  }

  /**
   * Apply a rule's suggestion.
   */
  async applySuggestion(rule: GuardrailRule): Promise<void> {
    await this.ensureInitialized();
    rule.hitCount++;
    await this.saveRule(rule);
  }

  /**
   * Deactivate a rule.
   */
  async deactivateRule(ruleId: string): Promise<void> {
    await this.ensureInitialized();
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.active = false;
      await this.saveRule(rule);
    }
  }

  /**
   * Activate a rule.
   */
  async activateRule(ruleId: string): Promise<void> {
    await this.ensureInitialized();
    const rule = this.rules.get(ruleId);
    if (rule) {
      rule.active = true;
      await this.saveRule(rule);
    }
  }

  /**
   * Delete a rule.
   */
  async deleteRule(ruleId: string): Promise<void> {
    await this.ensureInitialized();
    this.rules.delete(ruleId);

    const filePath = join(this.storageDir, `${ruleId}.json`);
    try {
      await unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Clear all rules.
   */
  async clearRules(): Promise<void> {
    await this.ensureInitialized();
    this.rules.clear();

    const files = await readdir(this.storageDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        await unlink(join(this.storageDir, file));
      }
    }
  }

  // ---- Private Methods ----

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private async loadRules(): Promise<void> {
    try {
      const files = await readdir(this.storageDir);

      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }

        try {
          const content = await readFile(join(this.storageDir, file), "utf-8");
          const rule = JSON.parse(content) as GuardrailRule;
          this.rules.set(rule.id, rule);
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  private async saveRule(rule: GuardrailRule): Promise<void> {
    const filePath = join(this.storageDir, `${rule.id}.json`);
    await writeFile(filePath, JSON.stringify(rule, null, 2));
  }

  private generateRule(failure: FailureContext): GuardrailRule {
    const id = this.generateRuleId(failure);
    const description = this.generateDescription(failure);
    const trigger = this.generateTrigger(failure);
    const suggestion = this.generateSuggestion(failure);

    return {
      id,
      description,
      trigger,
      suggestion,
      createdAt: Date.now(),
      hitCount: 0,
      active: true,
    };
  }

  private generateRuleId(failure: FailureContext): string {
    const content = `${failure.tool ?? ""}:${failure.error}:${failure.context}`;
    return createHash("md5").update(content).digest("hex").slice(0, 12);
  }

  private generateDescription(failure: FailureContext): string {
    if (failure.tool) {
      return `Rule learned from ${failure.tool} failure: ${failure.error.slice(0, 100)}`;
    }
    return `Rule learned from failure: ${failure.error.slice(0, 100)}`;
  }

  private generateTrigger(failure: FailureContext): GuardrailRule["trigger"] {
    const trigger: GuardrailRule["trigger"] = {};

    if (failure.tool) {
      trigger.toolName = failure.tool;
    }

    if (failure.error) {
      const errorPart = failure.error.split("\n")[0].slice(0, 100);
      trigger.errorPattern = errorPart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    return trigger;
  }

  private generateSuggestion(failure: FailureContext): string {
    const error = failure.error.toLowerCase();
    const tool = failure.tool?.toLowerCase() ?? "";

    if (tool.includes("shell") || tool.includes("exec")) {
      if (error.includes("not found") || error.includes("command not found")) {
        return "Before executing shell commands, verify the command exists using 'which' or 'command -v'";
      }
      if (error.includes("permission denied")) {
        return "Check file permissions before executing commands.";
      }
    }

    if (tool.includes("file") || tool.includes("read") || tool.includes("write")) {
      if (error.includes("enoent") || error.includes("no such file")) {
        return "Always check if a file exists before reading it.";
      }
    }

    if (failure.userFeedback) {
      return `User feedback: ${failure.userFeedback}`;
    }

    return `Avoid repeating the action that caused: ${failure.error.slice(0, 100)}`;
  }

  private findSimilarRule(newRule: GuardrailRule): GuardrailRule | undefined {
    for (const rule of this.rules.values()) {
      if (
        rule.trigger.toolName === newRule.trigger.toolName &&
        rule.trigger.errorPattern === newRule.trigger.errorPattern
      ) {
        return rule;
      }
    }
    return undefined;
  }

  private matchesTrigger(rule: GuardrailRule, context: ExecutionContext): boolean {
    if (rule.trigger.toolName && context.currentTool !== rule.trigger.toolName) {
      return false;
    }

    if (rule.trigger.failureCount && context.consecutiveFailures < rule.trigger.failureCount) {
      return false;
    }

    if (rule.trigger.errorPattern) {
      const pattern = new RegExp(rule.trigger.errorPattern, "i");
      const hasMatchingError = context.recentErrors.some((err) => pattern.test(err));
      if (!hasMatchingError) {
        return false;
      }
    }

    return true;
  }

  private emitTraceEvent(event: TraceEvent): void {
    this.traceWriter?.write(event);
  }
}
