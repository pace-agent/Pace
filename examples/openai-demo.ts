/**
 * Pace 真实 API Demo
 *
 * 使用 OpenAI API 演示 Pace 的渐进式上下文加载能力
 *
 * 运行方式：
 *   export OPENAI_API_KEY=sk-xxx
 *   npx tsx examples/openai-demo.ts
 */

import { Pace, OpenAIAdapter } from "@pace-agent/core";
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "@pace-agent/core";

// ---- 示例工具 Provider ----

class DemoToolProvider implements ResourceProvider {
  readonly type = "tool" as const;

  private tools = [
    {
      id: "web_search",
      name: "Web Search",
      description: "Search the web for information",
      tags: ["search", "web", "query"],
      riskLevel: "low" as const,
      summary: "Search the web using Brave Search API",
      parameterSummary: "query (string, required), count (number, optional)",
      example: 'web_search({ query: "TypeScript best practices", count: 5 })',
    },
    {
      id: "read_file",
      name: "Read File",
      description: "Read contents of a file",
      tags: ["file", "read", "fs"],
      riskLevel: "low" as const,
      summary: "Read file contents from the filesystem",
      parameterSummary: "path (string, required)",
      example: 'read_file({ path: "./README.md" })',
    },
    {
      id: "write_file",
      name: "Write File",
      description: "Write content to a file",
      tags: ["file", "write", "fs"],
      riskLevel: "medium" as const,
      summary: "Write content to a file, creates if not exists",
      parameterSummary: "path (string, required), content (string, required)",
      example: 'write_file({ path: "./output.txt", content: "Hello World" })',
    },
    {
      id: "execute_shell",
      name: "Execute Shell Command",
      description: "Run a shell command",
      tags: ["shell", "exec", "command"],
      riskLevel: "high" as const,
      summary: "Execute a shell command in the system",
      parameterSummary: "command (string, required), timeout (number, optional)",
      example: 'execute_shell({ command: "npm test" })',
    },
    {
      id: "delete_file",
      name: "Delete File",
      description: "Delete a file from filesystem",
      tags: ["file", "delete", "fs"],
      riskLevel: "critical" as const,
      summary: "Permanently delete a file - cannot be undone",
      parameterSummary: "path (string, required)",
      example: 'delete_file({ path: "./temp.txt" })',
    },
  ];

  async listL0(): Promise<L0Index[]> {
    return this.tools.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      type: "tool" as const,
      tags: t.tags,
      riskLevel: t.riskLevel,
    }));
  }

  async getL1(id: string): Promise<L1Preview> {
    const tool = this.tools.find((t) => t.id === id);
    if (!tool) throw new Error(`Tool ${id} not found`);
    return {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      type: "tool" as const,
      tags: tool.tags,
      riskLevel: tool.riskLevel,
      summary: tool.summary,
      parameterSummary: tool.parameterSummary,
      example: tool.example,
    };
  }

  async getL2(id: string): Promise<L2Payload> {
    const l1 = await this.getL1(id);
    return {
      ...l1,
      fullContent: JSON.stringify({
        name: l1.name,
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
        description: l1.description,
      }),
      schema: {
        type: "object",
        properties: {},
      },
    };
  }
}

// ---- 示例记忆 Provider ----

class DemoMemoryProvider implements ResourceProvider {
  readonly type = "memory" as const;

  private memories = [
    {
      id: "user_preference",
      name: "User Preferences",
      description: "User's coding preferences",
      tags: ["preference", "user", "config"],
      riskLevel: "low" as const,
      summary: "User prefers TypeScript, functional programming, and concise code",
      priority: "P0" as const,
    },
    {
      id: "project_context",
      name: "Project Context",
      description: "Current project information",
      tags: ["project", "context"],
      riskLevel: "low" as const,
      summary: "Pace framework - progressive agent runtime for token efficiency",
      priority: "P1" as const,
    },
  ];

  async listL0(): Promise<L0Index[]> {
    return this.memories.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      type: "memory" as const,
      tags: m.tags,
      riskLevel: m.riskLevel,
    }));
  }

  async getL1(id: string): Promise<L1Preview> {
    const mem = this.memories.find((m) => m.id === id);
    if (!mem) throw new Error(`Memory ${id} not found`);
    return {
      id: mem.id,
      name: mem.name,
      description: mem.description,
      type: "memory" as const,
      tags: mem.tags,
      riskLevel: mem.riskLevel,
      summary: mem.summary,
    };
  }

  async getL2(id: string): Promise<L2Payload> {
    const l1 = await this.getL1(id);
    return {
      ...l1,
      fullContent: l1.summary,
    };
  }
}

// ---- Helpers ----

function separator(label: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

function printTokenTable(rows: Array<{ label: string; tokens: number }>) {
  const max = Math.max(...rows.map((r) => r.tokens));
  for (const { label, tokens } of rows) {
    const bar = "█".repeat(Math.max(1, Math.round((tokens / max) * 25)));
    console.log(`  ${label.padEnd(28)} ${String(tokens).padStart(5)} tok  ${bar}`);
  }
}

// ---- Main Demo ----

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║     Pace Demo — Real OpenAI API with Progressive Load    ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // 检查 API Key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("\n❌ 错误: 请设置 OPENAI_API_KEY 环境变量");
    console.error("\n运行方式:");
    console.error("  export OPENAI_API_KEY=sk-xxx");
    console.error("  npx tsx examples/openai-demo.ts\n");
    process.exit(1);
  }

  console.log("\n✓ OPENAI_API_KEY 已设置");
  console.log("✓ 使用 gpt-4o-mini 模型");

  // 创建 LLM Adapter
  const llm = new OpenAIAdapter({ model: "gpt-4o-mini" });

  // 计算 full injection baseline
  const baselineTokens = 7 * 50 + 7 * 150; // 7 resources, ~50 L0 + ~150 L1 each
  console.log(`\n📊 Full injection baseline: ~${baselineTokens} tokens`);
  console.log("   (7 resources all at L1 level)");

  // 创建 Pace Runtime
  const pace = new Pace({
    llm,
    resources: [new DemoToolProvider(), new DemoMemoryProvider()],
    config: {
      budget: {
        maxTokensPerTask: 50_000,
        maxTokensPerTurn: 8_000,
      },
    },
  });

  console.log("\n📦 注册资源: 5 tools + 2 memories = 7 total");

  // ---- Turn 1: 无关查询 ----
  separator("Turn 1 — 无关查询 (期望只加载 L0 索引)");
  const q1 = "给我讲一个程序员笑话";
  console.log(`  用户: "${q1}"\n`);

  const turn1 = await pace.run(q1);
  const t1Ctx = turn1.tokenUsage.contextTokens;
  const t1L1 = turn1.trace.filter((e) => e.type === "RESOURCE_LOADED" && e.level === "L1").length;

  console.log(`  助手: ${turn1.reply}`);
  console.log(`\n  📈 上下文 tokens: ${t1Ctx}`);
  console.log(`  📦 L1 资源加载: ${t1L1} (0 = 只注入 L0 索引)`);

  const s1 = Math.round(((baselineTokens - t1Ctx) / baselineTokens) * 100);
  console.log(`\n  ✅ 节省 ~${s1}% tokens vs 全量注入`);

  printTokenTable([
    { label: "Pace 渐进式", tokens: t1Ctx },
    { label: "全量注入 baseline", tokens: baselineTokens },
  ]);

  // ---- Turn 2: 搜索相关查询 ----
  separator("Turn 2 — 搜索相关查询 (web_search 升级到 L1)");
  const q2 = "帮我搜索一下最新的 TypeScript 5.0 特性";
  console.log(`  用户: "${q2}"\n`);

  const turn2 = await pace.run(q2);
  const t2Ctx = turn2.tokenUsage.contextTokens;
  const t2L1Events = turn2.trace.filter((e) => e.type === "RESOURCE_LOADED" && e.level === "L1");

  console.log(`  助手: ${turn2.reply}`);
  console.log(`\n  📈 上下文 tokens: ${t2Ctx}`);
  console.log(`  📦 L1 资源加载: ${t2L1Events.length}`);

  for (const ev of t2L1Events) {
    if (ev.type === "RESOURCE_LOADED") {
      console.log(`     + ${ev.resourceId} → L1 (${ev.tokens} tokens)`);
    }
  }

  const s2 = Math.round(((baselineTokens - t2Ctx) / baselineTokens) * 100);
  console.log(`\n  ✅ 节省 ~${s2}% tokens vs 全量注入`);

  printTokenTable([
    { label: "Pace 渐进式", tokens: t2Ctx },
    { label: "全量注入 baseline", tokens: baselineTokens },
  ]);

  // ---- Turn 3: 跟进查询 (sticky 保持) ----
  separator("Turn 3 — 模糊跟进 (sticky 保持 web_search 在 L1)");
  const q3 = "还有其他相关的吗？";
  console.log(`  用户: "${q3}"\n`);

  const turn3 = await pace.run(q3);
  const t3Ctx = turn3.tokenUsage.contextTokens;
  const t3L1Events = turn3.trace.filter((e) => e.type === "RESOURCE_LOADED" && e.level === "L1");

  console.log(`  助手: ${turn3.reply}`);
  console.log(`\n  📈 上下文 tokens: ${t3Ctx}`);
  console.log(`  📦 L1 资源加载: ${t3L1Events.length} (sticky from Turn 2)`);

  // ---- 总结 ----
  separator("总结 — Token 节省统计");
  console.log("\n  Turn      Pace Tokens    Baseline    Savings");
  console.log("  " + "─".repeat(48));

  const turns = [
    { label: "Turn 1", ctx: t1Ctx },
    { label: "Turn 2", ctx: t2Ctx },
    { label: "Turn 3", ctx: t3Ctx },
  ];

  let totalPace = 0;
  let totalBaseline = 0;

  for (const { label, ctx } of turns) {
    const pct = Math.round(((baselineTokens - ctx) / baselineTokens) * 100);
    console.log(`  ${label.padEnd(10)} ${String(ctx).padStart(8)}     ${String(baselineTokens).padStart(8)}      ${pct}%`);
    totalPace += ctx;
    totalBaseline += baselineTokens;
  }

  console.log("  " + "─".repeat(48));
  const totalSavings = Math.round(((totalBaseline - totalPace) / totalBaseline) * 100);
  console.log(`  总计节省: ${totalSavings}% tokens`);

  console.log("\n  📁 Trace 文件: .pace/traces/");
  console.log("  查看: cat .pace/traces/*.jsonl | jq .\n");
}

main().catch((err) => {
  console.error("\n❌ Demo 失败:", err);
  process.exit(1);
});
