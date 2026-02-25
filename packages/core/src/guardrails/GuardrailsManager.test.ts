import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GuardrailsManager } from "./GuardrailsManager.js";
import type {
  GuardrailRule,
  FailureContext,
  ExecutionContext,
} from "./types.js";

describe("GuardrailsManager", () => {
  let tempDir: string;
  let storageDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `guardrails-test-${Date.now()}`);
    storageDir = join(tempDir, "guardrails");
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("initialization", () => {
    it("should create storage directory on initialize", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const rules = await manager.getRules();
      expect(Array.isArray(rules)).toBe(true);
    });

    it("should load existing rules on initialize", async () => {
      await mkdir(storageDir, { recursive: true });
      const existingRule: GuardrailRule = {
        id: "test-rule-1",
        description: "Test rule",
        trigger: { toolName: "test_tool" },
        suggestion: "Test suggestion",
        createdAt: Date.now(),
        hitCount: 0,
        active: true,
      };
      await writeFile(
        join(storageDir, "test-rule-1.json"),
        JSON.stringify(existingRule)
      );

      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const rules = await manager.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].id).toBe("test-rule-1");
    });
  });

  describe("learnFromFailure", () => {
    it("should create a new rule from failure", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const failure: FailureContext = {
        tool: "execute_shell",
        error: "Command not found: npm",
        context: "Trying to run npm install",
        timestamp: Date.now(),
      };

      const rule = await manager.learnFromFailure(failure);

      expect(rule.id).toBeDefined();
      expect(rule.description).toContain("execute_shell");
      expect(rule.trigger.toolName).toBe("execute_shell");
      expect(rule.suggestion).toBeDefined();
      expect(rule.active).toBe(true);
    });

    it("should reuse existing rule for similar failures", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const failure1: FailureContext = {
        tool: "execute_shell",
        error: "Command not found: npm",
        context: "Trying to run npm install",
        timestamp: Date.now(),
      };

      const failure2: FailureContext = {
        tool: "execute_shell",
        error: "Command not found: npm",
        context: "Trying to run npm test",
        timestamp: Date.now(),
      };

      const rule1 = await manager.learnFromFailure(failure1);
      const rule2 = await manager.learnFromFailure(failure2);

      expect(rule1.id).toBe(rule2.id);
      expect(rule2.hitCount).toBe(1);

      const rules = await manager.getRules();
      expect(rules).toHaveLength(1);
    });

    it("should call onRuleLearned callback", async () => {
      const onRuleLearned = vi.fn();
      const manager = new GuardrailsManager({ storageDir, onRuleLearned });
      await manager.initialize();

      const failure: FailureContext = {
        tool: "test_tool",
        error: "Test error",
        context: "Test context",
        timestamp: Date.now(),
      };

      const rule = await manager.learnFromFailure(failure);

      expect(onRuleLearned).toHaveBeenCalledTimes(1);
      expect(onRuleLearned).toHaveBeenCalledWith(rule);
    });
  });

  describe("checkTrigger", () => {
    it("should return null when no rules match", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      await manager.learnFromFailure({
        tool: "tool_a",
        error: "error_a",
        context: "context_a",
        timestamp: Date.now(),
      });

      const context: ExecutionContext = {
        currentTool: "tool_b",
        recentErrors: [],
        consecutiveFailures: 0,
        turnNumber: 1,
      };

      const rule = await manager.checkTrigger(context);
      expect(rule).toBeNull();
    });

    it("should return matching rule based on tool name", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      await manager.learnFromFailure({
        tool: "execute_shell",
        error: "command not found",
        context: "running command",
        timestamp: Date.now(),
      });

      const context: ExecutionContext = {
        currentTool: "execute_shell",
        recentErrors: ["command not found"],
        consecutiveFailures: 1,
        turnNumber: 1,
      };

      const rule = await manager.checkTrigger(context);
      expect(rule).not.toBeNull();
      expect(rule?.trigger.toolName).toBe("execute_shell");
    });

    it("should increment hit count when rule triggers", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      await manager.learnFromFailure({
        tool: "test_tool",
        error: "test error",
        context: "test context",
        timestamp: Date.now(),
      });

      const context: ExecutionContext = {
        currentTool: "test_tool",
        recentErrors: ["test error"],
        consecutiveFailures: 0,
        turnNumber: 1,
      };

      const rule1 = await manager.checkTrigger(context);
      expect(rule1?.hitCount).toBe(1);

      const rule2 = await manager.checkTrigger(context);
      expect(rule2?.hitCount).toBe(2);
    });

    it("should not match inactive rules", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const rule = await manager.learnFromFailure({
        tool: "test_tool",
        error: "test error",
        context: "test context",
        timestamp: Date.now(),
      });

      await manager.deactivateRule(rule.id);

      const context: ExecutionContext = {
        currentTool: "test_tool",
        recentErrors: ["test error"],
        consecutiveFailures: 0,
        turnNumber: 1,
      };

      const matched = await manager.checkTrigger(context);
      expect(matched).toBeNull();
    });
  });

  describe("rule management", () => {
    it("should deactivate and activate rules", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const rule = await manager.learnFromFailure({
        tool: "test_tool",
        error: "test error",
        context: "test context",
        timestamp: Date.now(),
      });

      expect(rule.active).toBe(true);

      await manager.deactivateRule(rule.id);
      const deactivatedRules = await manager.getRules();
      expect(deactivatedRules[0].active).toBe(false);

      await manager.activateRule(rule.id);
      const activatedRules = await manager.getRules();
      expect(activatedRules[0].active).toBe(true);
    });

    it("should delete a rule", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      const rule = await manager.learnFromFailure({
        tool: "test_tool",
        error: "test error",
        context: "test context",
        timestamp: Date.now(),
      });

      expect(await manager.getRules()).toHaveLength(1);

      await manager.deleteRule(rule.id);

      expect(await manager.getRules()).toHaveLength(0);
    });

    it("should clear all rules", async () => {
      const manager = new GuardrailsManager({ storageDir });
      await manager.initialize();

      await manager.learnFromFailure({
        tool: "tool1",
        error: "error1",
        context: "context1",
        timestamp: Date.now(),
      });

      await manager.learnFromFailure({
        tool: "tool2",
        error: "error2",
        context: "context2",
        timestamp: Date.now(),
      });

      expect(await manager.getRules()).toHaveLength(2);

      await manager.clearRules();

      expect(await manager.getRules()).toHaveLength(0);
    });
  });

  describe("persistence", () => {
    it("should persist rules to storage", async () => {
      const manager1 = new GuardrailsManager({ storageDir });
      await manager1.initialize();

      await manager1.learnFromFailure({
        tool: "test_tool",
        error: "test error",
        context: "test context",
        timestamp: Date.now(),
      });

      // Create new manager instance
      const manager2 = new GuardrailsManager({ storageDir });
      await manager2.initialize();

      const rules = await manager2.getRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].trigger.toolName).toBe("test_tool");
    });
  });
});
