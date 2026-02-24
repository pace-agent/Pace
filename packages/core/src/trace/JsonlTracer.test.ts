import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { JsonlTracer } from "./JsonlTracer.js";
import type { TraceEvent } from "../types/trace.js";

function tmpDir(): string {
  return path.join(os.tmpdir(), crypto.randomUUID());
}

describe("JsonlTracer", () => {
  let dir: string;
  let tracer: JsonlTracer;

  beforeEach(() => {
    dir = tmpDir();
    tracer = new JsonlTracer({ outputDir: dir, taskId: "test-task" });
  });

  afterEach(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("creates directory on flush", async () => {
    tracer.write({
      type: "LLM_CALL_START",
      timestamp: Date.now(),
      tokens: { context: 100, budget: 1000 },
    });
    await tracer.flush();
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("writes valid JSONL lines", async () => {
    const event: TraceEvent = {
      type: "LLM_CALL_START",
      timestamp: 1000,
      tokens: { context: 100, budget: 1000 },
    };
    tracer.write(event);
    await tracer.flush();

    const filePath = path.join(dir, "test-task.jsonl");
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: "LLM_CALL_START" });
  });

  it("appends on multiple flushes", async () => {
    tracer.write({
      type: "LLM_CALL_START",
      timestamp: 1000,
      tokens: { context: 100, budget: 1000 },
    });
    await tracer.flush();

    tracer.write({
      type: "LLM_CALL_END",
      timestamp: 2000,
      tokens: { input: 100, output: 50 },
      latencyMs: 500,
    });
    await tracer.flush();

    const filePath = path.join(dir, "test-task.jsonl");
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });

  it("computes metrics correctly", async () => {
    tracer.write({
      type: "LLM_CALL_START",
      timestamp: 1000,
      tokens: { context: 200, budget: 1000 },
    });
    tracer.write({
      type: "LLM_CALL_END",
      timestamp: 2000,
      tokens: { input: 200, output: 50 },
      latencyMs: 300,
    });
    tracer.write({
      type: "RESOURCE_LOADED",
      timestamp: 1500,
      resourceId: "tool:search",
      level: "L0",
      tokens: 40,
    });
    tracer.write({
      type: "RESOURCE_LOADED",
      timestamp: 1600,
      resourceId: "tool:search",
      level: "L1",
      tokens: 150,
    });
    await tracer.flush();

    const metrics = tracer.getMetrics();
    expect(metrics.totalLLMCalls).toBe(1);
    expect(metrics.totalInputTokens).toBe(200);
    expect(metrics.totalOutputTokens).toBe(50);
    expect(metrics.totalContextTokens).toBe(200);
    expect(metrics.resourcesLoadedByLevel.L0).toBe(1);
    expect(metrics.resourcesLoadedByLevel.L1).toBe(1);
    expect(metrics.avgLatencyMs).toBe(300);
  });

  it("does not write file if buffer is empty on flush", async () => {
    await tracer.flush();
    const filePath = path.join(dir, "test-task.jsonl");
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
