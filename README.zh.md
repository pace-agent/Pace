# Pace

> Progressive Agent Computing Engine — AI Agent 的高纪律性运行时框架

Pace 是一个 Node.js/TypeScript Agent 运行时，通过渐进式资源加载（L0/L1/L2 三层协议）大幅降低上下文 token 消耗，同时提供内置安全策略、终止控制、LLM 辅助相关性评分和完整可观测性。

[English Documentation](./README.md)

```
┌─────────────────────────────────────────────────┐
│                  Pace Runtime                    │
│                                                  │
│  ┌──────────┐  ┌───────────────┐  ┌──────────┐ │
│  │ Resource  │  │   Context     │  │  Budget   │ │
│  │ Registry  │──│   Compiler    │──│ Scheduler │ │
│  └──────────┘  └───────────────┘  └──────────┘ │
│       │          ↑ LLM Scoring            │     │
│  ┌──────────┐  ┌───────────────┐  ┌──────────┐ │
│  │   Tool    │  │   Security    │  │Termination│ │
│  │  Runtime  │──│  Controller   │──│Controller │ │
│  └──────────┘  └───────────────┘  └──────────┘ │
│       │                                    │     │
│  ┌──────────────────────────────────────────┐   │
│  │            Tracer（可观测性）             │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │         LLM Adapter（可插拔）             │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 核心特性

### 渐进式资源加载（L0 / L1 / L2）

所有资源（工具、记忆、技能、文档）遵循三层协议：

| 层级 | 大小 | 加载时机 | 内容 |
|------|------|----------|------|
| **L0 Index** | ~20–50 tokens | 始终注入 | id、名称、描述、标签、风险级别 |
| **L1 Preview** | ~100–300 tokens | 按相关性加载 | 摘要、参数说明、示例 |
| **L2 Payload** | ~500–5000 tokens | 仅执行时加载 | 完整内容、JSON Schema |

与全量注入相比，token 消耗可降低 **40%–80%**。

### 智能相关性评分（Phase 3 增强）

`ContextCompiler` 支持两种评分路径，决定哪些资源晋升到 L1：

**关键词模式**（默认，无额外 API 调用）：
- 关键词匹配（权重 0.6）：将用户 query 分词，与资源的 name/tags/description 匹配
- Sticky 奖励（权重 0.4）：上一轮已加载的 L1 资源自动获得加分，保持上下文连贯性

**LLM 辅助模式**（Phase 3 新增，可选）：
- 提供 `scoringLlm` 适配器后启用（推荐用低成本小模型，如 claude-haiku-4-5）
- 将所有 L0 资源元数据发送给评分 LLM，获取 0.0–1.0 的精确相关性分
- Sticky 奖励同样叠加在 LLM 分数之上
- LLM 调用失败时自动降级为关键词评分（fallback）
- 支持三种模式：`keyword`（默认）/ `llm`（始终用 LLM）/ `auto`（候选数 ≥ 阈值时切换）
- 每次编译发出 `RELEVANCE_SCORING` trace 事件，记录实际使用的评分方式和耗时

### 安全策略（Phase 2）

`SecurityController` 实现 S0 规则引擎，三档 profile：

| Profile | 自动通过 | 需要审批 | 直接拒绝 |
|---------|---------|---------|---------|
| `open` | low + medium | high | critical |
| `balanced`（默认）| low | medium + high | critical |
| `strict` | 无 | medium + high | low + critical |

**S0 硬规则**（任何 profile 下均生效）：
- Shell 命令执行 → 无条件拒绝
- Global 范围的 delete → 无条件拒绝
- critical 风险级别 → 无条件拒绝
- 不可逆的 batch 操作 → 升级为人工审批

### 终止控制（Phase 2）

`TerminationController` 检测四种停止条件：

| 条件 | 触发 | 默认阈值 |
|------|------|---------|
| `budget` | token 消耗占预算比例超限 | 95% |
| `retry` | 连续工具调用失败次数超限 | 3 次 |
| `stagnation` | LLM 连续输出相同内容 | 3 次 |
| `risk` | 安全策略连续拒绝次数超限 | 2 次 |

### Agentic 工具执行循环（Phase 2）

当 LLM 返回 `tool_calls` 时，PaceRuntime 自动进入循环：

1. 终止策略检查 → 超限则停止
2. 安全策略评估 → 不通过则注入拒绝结果
3. 执行工具 → 写入 `TOOL_INVOKED` trace 事件
4. 将工具结果注入消息列表
5. 再次调用 LLM → 重复直到返回 `stop`

### 预算控制

`BudgetScheduler` 在任务级别和轮次级别双重追踪 token 消耗，防止超出预算。

### 全链路可观测

每次资源加载、LLM 调用、工具执行、策略决策、相关性评分都会发出结构化 `TraceEvent`，写入 `.pace/traces/*.jsonl`。

---

## 快速开始

```bash
pnpm install
```

### 使用 OpenAI（原有方式）

```typescript
import { Pace } from "@pace-agent/core";
import { OpenAIAdapter } from "@pace-agent/llm-openai";

const agent = new Pace({
  llm: new OpenAIAdapter({ model: "gpt-4o" }),
  resources: [myToolProvider, myMemoryProvider],
  config: {
    budget: { maxTokensPerTask: 20_000, maxTokensPerTurn: 4_000 },
    security: "balanced",
    termination: { maxRetries: 3, maxStagnation: 3, maxSecurityDenials: 2 },
  },
});

const result = await agent.run("搜索最新的 TypeScript release notes");
console.log(result.reply);
console.log(result.tokenUsage);        // { inputTokens, outputTokens, contextTokens, totalTokens }
console.log(result.toolCallsExecuted); // 执行的工具调用次数
console.log(result.stopped);           // 是否被终止策略提前停止
```

### 使用 Anthropic + LLM 评分 + SQLite 记忆（Phase 3 完整示例）

```typescript
import { loadPaceConfig } from "@pace-agent/config-loader";
import { Pace } from "@pace-agent/core";
import { AnthropicAdapter } from "@pace-agent/llm-anthropic";
import { SQLiteMemoryProvider } from "@pace-agent/memory-sqlite";

// 从 pace.config.yaml 读取配置
const { config } = await loadPaceConfig();

const memory = new SQLiteMemoryProvider({ dbPath: ".pace/memory.db" });

const agent = new Pace({
  llm: new AnthropicAdapter({ model: "claude-opus-4-6" }),
  resources: [myToolProvider, memory],
  config,
  // 使用低成本小模型做相关性评分，不占任务 token 预算
  scoringLlm: new AnthropicAdapter({ model: "claude-haiku-4-5-20251001" }),
});

const result = await agent.run("搜索 TypeScript 5.4 新特性");

// 查看评分事件
const scoringEvents = result.trace.filter(e => e.type === "RELEVANCE_SCORING");
// → [{ mode: "llm", candidateCount: 5, selectedCount: 2, latencyMs: 340 }]
```

---

## 包结构

| 包 | 状态 | 说明 |
|----|------|------|
| `@pace-agent/core` | ✅ Phase 3 已完成 | 核心运行时：ResourceRegistry、ContextCompiler（含 LLM 评分）、BudgetScheduler、JsonlTracer、PaceRuntime |
| `@pace-agent/llm-openai` | ✅ Phase 1 已完成 | OpenAI 兼容 LLM 适配器，支持 tool_calls |
| `@pace-agent/llm-anthropic` | ✅ Phase 3 新增 | Anthropic Claude 适配器，自动合并连续工具结果消息 |
| `@pace-agent/config-loader` | ✅ Phase 3 新增 | YAML/JSON 配置文件加载，支持环境变量插值 |
| `@pace-agent/memory-sqlite` | ✅ Phase 3 新增 | SQLite 持久化记忆 Provider，含 FTS5 全文索引和 TTL 过期 |
| `@pace-agent/security` | ✅ Phase 2 已完成 | SecurityController：S0 规则引擎 + open/balanced/strict 三档 profile |
| `@pace-agent/termination` | ✅ Phase 2 已完成 | TerminationController：四种停止条件 + buildFailureReport() |
| `@pace-agent/memory-file` | ✅ Phase 2 已完成 | 基于文件系统的记忆 Provider，支持 p0/p1/p2 优先级分层和 TTL 过期 |
| `@pace-agent/cli` | ✅ Phase 1 已完成 | CLI 演示（含 token 节省对比） |

---

## Phase 3 新增能力详解

### @pace-agent/llm-anthropic — Anthropic 适配器

```typescript
import { AnthropicAdapter } from "@pace-agent/llm-anthropic";

const llm = new AnthropicAdapter({
  model: "claude-opus-4-6",
  apiKey: process.env.ANTHROPIC_API_KEY, // 或自动读取环境变量
});
```

**消息格式自动转换**（Pace 内部格式 → Anthropic API 格式）：

| Pace 内部格式 | Anthropic API |
|-------------|---------------|
| `role:"system"` 消息 | 独立 `system` 参数 |
| `role:"assistant"` + `toolCalls` | `content: [{type:"tool_use",...}]` |
| 连续多条 `role:"tool"` 消息 | 合并为单条 `user` 消息（含多个 `tool_result` blocks） |

`finishReason` 映射：`end_turn/stop_sequence → "stop"`，`tool_use → "tool_calls"`，`max_tokens → "length"`。

---

### @pace-agent/config-loader — 配置文件加载

自动搜索顺序：`pace.config.yaml` → `pace.config.yml` → `pace.config.json`

```yaml
# pace.config.yaml
budget:
  maxTokensPerTask: 30000
  maxTokensPerTurn: 5000

security: balanced

scoring:
  mode: auto          # keyword | llm | auto
  llmThresholdCandidates: 8  # auto 模式：候选数 >= 8 时切换 LLM 评分

trace:
  output: .pace/traces/

# 支持环境变量插值（在 YAML 解析前处理）
# ${VAR}           → 必须存在，否则报错
# ${VAR:-default}  → 不存在时使用默认值
# ${VAR:?message}  → 不存在时抛出自定义错误
```

```typescript
import { loadPaceConfig, loadPaceConfigSync } from "@pace-agent/config-loader";

// 异步加载
const { config, configPath, usedDefaults } = await loadPaceConfig();

// 同步加载
const result = loadPaceConfigSync({ cwd: "/project", required: false });

// 显式指定路径
const result = await loadPaceConfig({ configPath: "./configs/prod.yaml" });
```

---

### @pace-agent/memory-sqlite — SQLite 高性能记忆

```typescript
import { SQLiteMemoryProvider } from "@pace-agent/memory-sqlite";

const memory = new SQLiteMemoryProvider({
  dbPath: ".pace/memory.db",  // 或 ":memory:" 用于测试
  summaryMaxChars: 500,        // L1 摘要截断字数（默认 500）
  wal: true,                   // WAL 模式，更好的并发性能（默认开启）
});

// 写入记忆（同名自动 upsert）
const id = await memory.write(
  { name: "用户偏好", description: "用户设置", priority: "P0", tags: ["prefs"], ttlDays: 30 },
  "用户偏好使用 TypeScript，喜欢简洁的代码风格。"
);

// 列出所有有效记忆（自动过滤已过期条目）
const entries = await memory.list();

// 与 Pace 集成（完全替换 FileMemoryProvider）
const agent = new Pace({ llm, resources: [memory] });
```

**与 FileMemoryProvider 完全兼容**：相同接口、相同 L0 id 前缀（`memory:`）、相同摘要截断行为。

内置 FTS5 全文索引表（含触发器同步），为 Phase 4 全文检索功能预留。

---

### ContextCompiler LLM 评分模式

```typescript
import { Pace } from "@pace-agent/core";

const agent = new Pace({
  llm: mainLlm,
  resources: [myProvider],
  scoringLlm: cheapLlm,          // 独立评分 LLM，不计入任务 token 预算
  config: {
    scoring: {
      mode: "auto",              // 候选数 >= 10 时自动切换 LLM 评分
      llmThresholdCandidates: 10,
      scoringMaxTokens: 256,
    },
  },
});

const result = await agent.run("查找 TypeScript 相关资源");

// trace 中查看评分事件
result.trace
  .filter(e => e.type === "RELEVANCE_SCORING")
  .forEach(e => {
    console.log(`mode=${e.mode}, candidates=${e.candidateCount}, selected=${e.selectedCount}, latency=${e.latencyMs}ms`);
    if (e.fallbackUsed) console.log("⚠ LLM 评分失败，已降级为关键词评分");
  });
```

---

## 实现一个 ToolProvider

```typescript
import type { ResourceProvider, ToolProvider, ToolDefinition, ToolResult } from "@pace-agent/core";

class MyToolProvider implements ResourceProvider, ToolProvider {
  readonly type = "tool" as const;

  // L0：始终注入，极轻量
  async listL0() {
    return [{ id: "tool:web_search", name: "Web Search",
              description: "Search the web", type: "tool", tags: ["search"], riskLevel: "low" }];
  }

  async getL1(id: string) { /* L1 preview */ }
  async getL2(id: string) { /* L2 full schema */ }

  // ToolProvider 接口
  async listTools(): Promise<ToolDefinition[]> {
    return [{ name: "web_search", description: "Search the web",
              tags: ["search"], risk: "low", preview: "...",
              parameters: { type: "object", properties: { query: { type: "string" } } },
              execute: async ({ query }) => searchApi(query) }];
  }

  async getTool(name: string) {
    return (await this.listTools()).find(t => t.name === name);
  }

  async executeTool(name: string, params: unknown): Promise<ToolResult> {
    const tool = await this.getTool(name);
    if (!tool) return { success: false, error: "Unknown tool", latencyMs: 0 };
    const start = Date.now();
    const output = await tool.execute(params as any);
    return { success: true, output, latencyMs: Date.now() - start };
  }
}
```

---

## 开发

### 环境要求

- Node.js >= 22（Node 20 可运行，会有 WARN 提示）
- pnpm >= 9

### 安装

```bash
git clone <repo-url>
cd pace
pnpm install
```

### 常用命令

```bash
pnpm test         # 运行全部 104 个测试
pnpm build        # 构建所有包
pnpm lint         # 代码检查
pnpm clean        # 清除 dist 目录
```

### 运行 Demo

```bash
# 无需 API Key（使用 MockLLMAdapter，不产生任何费用）
pnpm demo

# 使用真实 OpenAI API
OPENAI_API_KEY=sk-... pnpm demo
```

### 项目结构

```
pace/
├── packages/
│   ├── core/src/
│   │   ├── types/          # 全部接口定义（resource, llm, trace, security, termination, memory, tool, action, config）
│   │   ├── registry/       # ResourceRegistry
│   │   ├── compiler/       # ContextCompiler（含 LLM 评分）、TokenEstimator
│   │   ├── budget/         # BudgetScheduler
│   │   ├── trace/          # JsonlTracer
│   │   └── runtime/        # PaceRuntime（导出为 Pace）
│   ├── llm-openai/         # OpenAI 适配器
│   ├── llm-anthropic/      # Anthropic 适配器（Phase 3）
│   ├── config-loader/      # pace.config.yaml 加载（Phase 3）
│   ├── memory-sqlite/      # SQLite 记忆 Provider（Phase 3）
│   ├── security/           # SecurityController
│   ├── termination/        # TerminationController
│   ├── memory-file/        # FileMemoryProvider
│   └── cli/                # Demo 入口 + Mock 资源
├── package.json
├── tsconfig.base.json
└── vitest.config.ts
```

---

## Roadmap

### v0.1 — Phase 1：核心运行时 ✅

- [x] L0/L1/L2 三层资源协议
- [x] ResourceRegistry：多 Provider 聚合 + L0 缓存
- [x] ContextCompiler：关键词相关性评分 + Sticky L1 + 预算裁剪
- [x] BudgetScheduler：任务级 + 轮次级 token 预算
- [x] JsonlTracer：JSONL 事件写入
- [x] PaceRuntime：多轮对话 + 动态 system prompt
- [x] OpenAI 兼容适配器
- [x] CLI Demo + token 节省对比

### v0.2 — Phase 2：安全与终止 ✅

- [x] SecurityController：S0 规则引擎 + open/balanced/strict 三档 profile
- [x] TerminationController：budget/retry/stagnation/risk 四种停止条件 + buildFailureReport()
- [x] Agentic 工具执行循环：安全检查 → 执行 → 注入结果 → 再次调用 LLM
- [x] FileMemoryProvider：文件系统记忆，p0/p1/p2 优先级分层，TTL 过期过滤
- [x] Message 类型扩展 toolCalls 字段；OpenAIAdapter 支持 assistant tool_calls 序列化
- [x] RunResult 新增 stopped、stopReason、toolCallsExecuted 字段

### v0.3 — Phase 3：生态扩展 ✅

- [x] Anthropic Claude 适配器（`@pace-agent/llm-anthropic`）
- [x] LLM 辅助相关性评分（ContextCompiler scoringLlm + mode + fallback）
- [x] `pace.config.yaml` 配置文件加载（`@pace-agent/config-loader`，含环境变量插值）
- [x] SQLite 持久化记忆 Provider（`@pace-agent/memory-sqlite`，含 FTS5 全文索引）
- [x] `RELEVANCE_SCORING` trace 事件 + `scoring` 配置节

### v0.4 — Phase 4：多 Agent 与可观测性（规划中）

- [ ] 多 Agent 编排（manager-worker 模式）
- [ ] MCP 工具桥
- [ ] HTML 可观测性 Dashboard
- [ ] SQLite FTS5 全文搜索 API 开放

---

## License

MIT
