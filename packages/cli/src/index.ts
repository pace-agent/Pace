#!/usr/bin/env node
import type { LLMAdapter, Message, LLMResponse } from "@pace-agent/core";
import { Pace } from "@pace-agent/core";
import { MockToolProvider, MockMemoryProvider } from "./demo/mock-resources.js";

// ---- Mock LLM Adapter (no API key needed) ----

class MockLLMAdapter implements LLMAdapter {
  async chat(params: {
    messages: Message[];
    maxTokens?: number;
  }): Promise<LLMResponse> {
    const systemMsg = params.messages.find((m) => m.role === "system");
    const contextTokens = systemMsg ? Math.ceil(systemMsg.content.length / 4) : 0;
    return {
      content: `[Mock Reply] Received ${params.messages.length} messages. System context ~${contextTokens} tokens.`,
      usage: { inputTokens: contextTokens + 20, outputTokens: 30 },
      finishReason: "stop",
    };
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

// ---- Helpers ----

function separator(label: string) {
  const line = "─".repeat(62);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

function printTokenTable(rows: Array<{ label: string; tokens: number }>) {
  const max = Math.max(...rows.map((r) => r.tokens));
  for (const { label, tokens } of rows) {
    const bar = "█".repeat(Math.max(1, Math.round((tokens / max) * 30)));
    console.log(`  ${label.padEnd(32)} ${String(tokens).padStart(5)} tokens  ${bar}`);
  }
}

// Compute "full injection" baseline: all 8 resources rendered at L1 level
async function computeFullInjectionTokens(): Promise<number> {
  const toolProvider = new MockToolProvider();
  const memProvider = new MockMemoryProvider();
  const allL0 = [...(await toolProvider.listL0()), ...(await memProvider.listL0())];

  let total = 0;
  for (const r of allL0) {
    // L0 index line (~30 tokens each)
    const l0Text = `- [${r.type}] ${r.id}: ${r.name} — ${r.description}\n  tags: ${r.tags.join(", ")} | risk: ${r.riskLevel ?? ""}`;
    total += Math.ceil(l0Text.length / 4);

    // L1 detail block
    const l1 = r.type === "tool" ? await toolProvider.getL1(r.id) : await memProvider.getL1(r.id);
    const l1Lines = [
      `### ${l1.name} (${l1.id})`,
      `Type: ${l1.type} | Risk: ${l1.riskLevel ?? "unspecified"}`,
      (l1 as any).summary ?? l1.description,
    ];
    if ((l1 as any).parameterSummary) l1Lines.push(`Parameters: ${(l1 as any).parameterSummary}`);
    if ((l1 as any).example) l1Lines.push(`Example: ${(l1 as any).example}`);
    total += Math.ceil(l1Lines.join("\n").length / 4);
  }
  return total;
}

// ---- Demo ----

async function runDemo() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║       Pace Phase 1 Demo — Progressive Context Loading       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("\n  Resources: 5 tools + 3 memories (8 total)");

  const hasApiKey = !!process.env.OPENAI_API_KEY;
  console.log(
    hasApiKey
      ? "\n  ✓ OPENAI_API_KEY detected — using real OpenAI API"
      : "\n  ⚠  No OPENAI_API_KEY — using MockLLMAdapter (no API calls)",
  );

  let llm: LLMAdapter;
  if (hasApiKey) {
    const { OpenAIAdapter } = await import("@pace-agent/llm-openai");
    llm = new OpenAIAdapter({ model: "gpt-4o-mini" });
  } else {
    llm = new MockLLMAdapter();
  }

  const fullInjectionTokens = await computeFullInjectionTokens();
  console.log(`\n  Full injection baseline (all 8 resources at L1): ${fullInjectionTokens} tokens`);

  const runtime = new Pace({
    llm,
    resources: [new MockToolProvider(), new MockMemoryProvider()],
    config: {
      budget: { maxTokensPerTask: 50_000, maxTokensPerTurn: 8_000 },
    },
  });

  // ── Turn 1: Unrelated query — expects L0 only ─────────────────
  separator("Turn 1 — Unrelated query (expect L0 only)");
  const q1 = "Tell me a joke about programming";
  console.log(`  Query: "${q1}"`);

  const turn1 = await runtime.run(q1);
  const t1Ctx = turn1.tokenUsage.contextTokens;
  const t1L1 = turn1.trace.filter((e) => e.type === "RESOURCE_LOADED" && e.level === "L1").length;

  console.log(`\n  Reply: ${turn1.reply}`);
  console.log(`\n  Context tokens used : ${t1Ctx}`);
  console.log(`  L1 resources loaded : ${t1L1}  (0 = only L0 index injected)`);
  console.log("\n  Token comparison:");
  printTokenTable([
    { label: "Pace progressive", tokens: t1Ctx },
    { label: "Full injection (baseline)", tokens: fullInjectionTokens },
  ]);
  const s1 = Math.round(((fullInjectionTokens - t1Ctx) / fullInjectionTokens) * 100);
  console.log(`\n  ✓ Saved ~${s1}% tokens vs full injection`);

  // ── Turn 2: Search query — web_search promoted to L1 ──────────
  separator("Turn 2 — Search query (web_search promoted to L1)");
  const q2 = "Search the web for recent TypeScript security advisories";
  console.log(`  Query: "${q2}"`);

  const turn2 = await runtime.run(q2);
  const t2Ctx = turn2.tokenUsage.contextTokens;
  const t2L1Events = turn2.trace.filter((e) => e.type === "RESOURCE_LOADED" && e.level === "L1");

  console.log(`\n  Reply: ${turn2.reply}`);
  console.log(`\n  Context tokens used : ${t2Ctx}`);
  console.log(`  L1 resources loaded : ${t2L1Events.length}`);
  for (const ev of t2L1Events) {
    if (ev.type === "RESOURCE_LOADED") {
      console.log(`    + ${ev.resourceId} promoted to L1 (${ev.tokens} tokens)`);
    }
  }
  console.log("\n  Token comparison:");
  printTokenTable([
    { label: "Pace progressive", tokens: t2Ctx },
    { label: "Full injection (baseline)", tokens: fullInjectionTokens },
  ]);
  const s2 = Math.round(((fullInjectionTokens - t2Ctx) / fullInjectionTokens) * 100);
  console.log(`\n  ✓ Saved ~${s2}% tokens vs full injection`);

  // ── Turn 3: Vague follow-up — sticky keeps web_search ─────────
  separator("Turn 3 — Vague follow-up (sticky: web_search stays in L1)");
  const q3 = "Anything else relevant?";
  console.log(`  Query: "${q3}"`);

  const turn3 = await runtime.run(q3);
  const t3Ctx = turn3.tokenUsage.contextTokens;
  const t3L1Events = turn3.trace.filter((e) => e.type === "RESOURCE_LOADED" && e.level === "L1");

  console.log(`\n  Reply: ${turn3.reply}`);
  console.log(`\n  Context tokens used : ${t3Ctx}`);
  console.log(`  L1 resources loaded : ${t3L1Events.length}  (sticky from Turn 2)`);
  for (const ev of t3L1Events) {
    if (ev.type === "RESOURCE_LOADED") {
      console.log(`    + ${ev.resourceId} retained via sticky (${ev.tokens} tokens)`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────
  separator("Summary — Token Savings per Turn");
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`${"Turn".padEnd(10)} ${pad("Pace Tokens", 12)} ${pad("Baseline", 10)} ${pad("Savings", 9)}`);
  console.log("─".repeat(46));
  for (const [label, ctx] of [["Turn 1", t1Ctx], ["Turn 2", t2Ctx], ["Turn 3", t3Ctx]] as const) {
    const pct = Math.round(((fullInjectionTokens - ctx) / fullInjectionTokens) * 100);
    console.log(`${label.padEnd(10)} ${pad(ctx, 12)} ${pad(fullInjectionTokens, 10)} ${pad(pct + "%", 9)}`);
  }

  console.log("\n  Trace files written to: .pace/traces/");
  console.log("  Run: cat .pace/traces/*.jsonl | head -20\n");
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
