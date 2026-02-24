import * as fs from "node:fs";
import * as path from "node:path";
import type { TraceEvent, TraceWriter } from "../types/trace.js";

export interface JsonlTracerOptions {
  outputDir: string;
  taskId?: string;
  bufferSize?: number;
}

export class JsonlTracer implements TraceWriter {
  private buffer: TraceEvent[] = [];
  private readonly outputDir: string;
  private readonly taskId: string;
  private readonly bufferSize: number;
  private metrics = {
    totalLLMCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalContextTokens: 0,
    resourcesLoadedByLevel: { L0: 0, L1: 0, L2: 0 },
    latencies: [] as number[],
  };

  constructor(options: JsonlTracerOptions) {
    this.outputDir = options.outputDir;
    this.taskId = options.taskId ?? `task-${Date.now()}`;
    this.bufferSize = options.bufferSize ?? 50;
  }

  write(event: TraceEvent): void {
    this.buffer.push(event);
    this.updateMetrics(event);
    if (this.buffer.length >= this.bufferSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const filePath = path.join(this.outputDir, `${this.taskId}.jsonl`);
    await fs.promises.mkdir(this.outputDir, { recursive: true });
    const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await fs.promises.appendFile(filePath, lines, "utf-8");
  }

  getMetrics() {
    const totalLatency = this.metrics.latencies.reduce((s, v) => s + v, 0);
    const avgLatencyMs = this.metrics.latencies.length
      ? totalLatency / this.metrics.latencies.length
      : 0;
    return {
      totalLLMCalls: this.metrics.totalLLMCalls,
      totalInputTokens: this.metrics.totalInputTokens,
      totalOutputTokens: this.metrics.totalOutputTokens,
      totalContextTokens: this.metrics.totalContextTokens,
      resourcesLoadedByLevel: { ...this.metrics.resourcesLoadedByLevel },
      avgLatencyMs,
    };
  }

  private updateMetrics(event: TraceEvent): void {
    switch (event.type) {
      case "LLM_CALL_END":
        this.metrics.totalLLMCalls++;
        this.metrics.totalInputTokens += event.tokens.input;
        this.metrics.totalOutputTokens += event.tokens.output;
        this.metrics.latencies.push(event.latencyMs);
        break;
      case "LLM_CALL_START":
        this.metrics.totalContextTokens += event.tokens.context;
        break;
      case "RESOURCE_LOADED":
        this.metrics.resourcesLoadedByLevel[event.level]++;
        break;
    }
  }
}
