# Pace

> Progressive Agent Computing Engine — AI Agent 的高纪律性运行时框架

Pace 是一个 Node.js/TypeScript Agent 运行时，通过渐进式资源加载（L0/L1/L2 三层协议）大幅降低上下文 token 消耗，同时提供内置预算控制和完整可观测性。

[English Documentation](./README.md)

```
┌─────────────────────────────────────────────────┐
│                  Pace Runtime                    │
│                                                  │
│  ┌──────────┐  ┌───────────────┐  ┌──────────┐ │
│  │ Resource  │  │   Context     │  │  Budget   │ │
│  │ Registry  │──│   Compiler    │──│ Scheduler │ │
│  └──────────┘  └───────────────┘  └──────────┘ │
│       │                                    │     │
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

### 智能相关性评分

`ContextCompiler` 对每个资源打分，决定是否晋升到 L1：

- **关键词匹配**（权重 0.6）：将用户 query 分词，与资源的 name/tags/description 匹配
- **Sticky 奖励**（权重 0.4）：上一轮已加载的 L1 资源自动获得加分，保持上下文连贯性
- 阈值（默认 0.3）以上的前 5 个候选资源晋升到 L1

### 预算控制

`BudgetScheduler` 在任务级别和轮次级别双重追踪 token 消耗，防止超出预算。

### 全链路可观测

每次资源加载、LLM 调用都会发出结构化 `TraceEvent`，包含 token 数量和延迟，写入 `.pace/traces/*.jsonl`。

---

## 快速开始

```bash
pnpm install
```

```typescript
import { Pace } from "@pace-agent/core";
import { OpenAIAdapter } from "@pace-agent/llm-openai";

const agent = new Pace({
  llm: new OpenAIAdapter({ model: "gpt-4o" }),
  resources: [myToolProvider, myMemoryProvider],
  config: {
    budget: { maxTokensPerTask: 20_000, maxTokensPerTurn: 4_000 },
  },
});

const result = await agent.run("搜索最新的 TypeScript release notes");
console.log(result.reply);
console.log(result.tokenUsage);
// { inputTokens: 312, outputTokens: 85, contextTokens: 282, totalTokens: 397 }

console.log(result.trace);
// TraceEvent[]：每个 RESOURCE_LOADED、LLM_CALL_START/END 事件
```

---

## 实现一个 ResourceProvider

```typescript
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "@pace-agent/core";

class MyToolProvider implements ResourceProvider {
  readonly type = "tool" as const;  // "tool" | "memory" | "skill" | "document"

  // L0：始终注入，极轻量
  async listL0(): Promise<L0Index[]> {
    return [{
      id: "tool:web_search",         // 格式：<type>:<slug>
      name: "Web Search",
      description: "Search the web for current information",
      type: "tool",
      tags: ["search", "web"],
      riskLevel: "low",
    }];
  }

  // L1：相关时加载，包含摘要和参数说明
  async getL1(id: string): Promise<L1Preview> {
    return {
      id, name: "Web Search", description: "...", type: "tool", tags: ["search", "web"],
      summary: "通过搜索引擎 API 搜索互联网，返回标题、摘要和 URL。",
      parameterSummary: "query (string, 必填), maxResults (number, 默认 10)",
      example: '{ "query": "TypeScript 5.4 release", "maxResults": 5 }',
    };
  }

  // L2：执行时加载，包含完整 Schema
  async getL2(id: string): Promise<L2Payload> {
    return { ...await this.getL1(id), fullContent: "<完整 JSON Schema>" };
  }
}
```

---

## 包结构

| 包 | 状态 | 说明 |
|----|------|------|
| `@pace-agent/core` | ✅ Phase 1 已完成 | 核心运行时：ResourceRegistry、ContextCompiler、BudgetScheduler、JsonlTracer、PaceRuntime |
| `@pace-agent/llm-openai` | ✅ Phase 1 已完成 | OpenAI 兼容 LLM 适配器 |
| `@pace-agent/cli` | ✅ Phase 1 已完成 | CLI 演示（含 token 节省对比） |
| `@pace-agent/security` | 🔜 Phase 2 | 安全控制器 + 内置策略（open/balanced/strict） |
| `@pace-agent/termination` | 🔜 Phase 2 | 终止控制器（BudgetStop、RetryStop、StagnationStop） |
| `@pace-agent/memory-file` | 🔜 Phase 2 | 基于文件系统的记忆 Provider |

---

## 开发

### 环境要求

- Node.js >= 22
- pnpm >= 9

### 安装

```bash
git clone <repo-url>
cd pace
pnpm install
```

### 常用命令

```bash
pnpm test         # 运行全部 37 个测试
pnpm build        # 构建所有包
pnpm lint         # 代码检查
pnpm clean        # 清除 dist 目录
```

### 运行 Demo

```bash
# 无需 API Key（使用 MockLLMAdapter，不产生任何费用）
node packages/cli/src/index.ts

# 使用真实 OpenAI API
OPENAI_API_KEY=sk-... node packages/cli/src/index.ts
```

---

## Phase 1 完成内容与验证

### 已完成能力

| 模块 | 能力 |
|------|------|
| **ResourceRegistry** | 聚合多个 ResourceProvider；L0 结果缓存（注册新 Provider 时自动失效）；按资源 ID 前缀路由 L1/L2 请求 |
| **ContextCompiler** | 关键词相关性评分；Sticky 轮次奖励；L0 始终全量注入；按预算贪心裁剪 L1；组装标准化 system prompt |
| **BudgetScheduler** | 任务级和轮次级 token 追踪；`allocateTurnBudget()` 保留回复空间；`resetTurn()` 不影响任务总量 |
| **JsonlTracer** | 同步缓冲写入；异步 flush 到 JSONL 文件；自动创建目录；追加写入（多轮不覆盖）；metrics 统计 |
| **PaceRuntime (Pace)** | 多轮对话历史累积；每轮 system prompt 动态编译；Sticky L1 跨轮传递；trace 事件完整记录 |
| **OpenAIAdapter** | 适配 openai SDK；角色映射；finishReason 映射；tool_calls 支持（Phase 2 执行） |

### 验证方式

#### 1. 单元测试（最快，无需外部依赖）

```bash
pnpm test
```

预期输出：
```
 ✓ packages/core/src/registry/ResourceRegistry.test.ts     (6 tests)
 ✓ packages/core/src/budget/BudgetScheduler.test.ts        (7 tests)
 ✓ packages/core/src/trace/JsonlTracer.test.ts             (5 tests)
 ✓ packages/core/src/compiler/ContextCompiler.test.ts      (7 tests)
 ✓ packages/core/src/runtime/PaceRuntime.test.ts           (7 tests)
 ✓ packages/llm-openai/src/OpenAIAdapter.test.ts           (5 tests)

 Tests  37 passed (37)
```

#### 2. CLI Demo（无需 API Key）

```bash
node packages/cli/src/index.ts
```

观察：
- **Turn 1**（"What is the weather today?"）：仅加载 L0，上下文 token 极少
- **Turn 2**（"Search the web..."）：`tool:web_search` 晋升到 L1，可见 L1 资源列表
- 最终打印 token 节省对比表

#### 3. 验证渐进式加载效果

在代码中直接验证：

```typescript
import { Pace, ResourceRegistry, ContextCompiler, TokenEstimator, BudgetScheduler } from "@pace-agent/core";

const registry = new ResourceRegistry();
registry.register(myProvider);

const estimator = new TokenEstimator();
const budget = new BudgetScheduler({ maxTokensPerTask: 20_000, maxTokensPerTurn: 4_000, estimator });
const events: any[] = [];
const tracer = { write: (e: any) => events.push(e), flush: async () => {} };

const compiler = new ContextCompiler({ registry, budget, estimator, tracer });

// Turn 1：无关 query
const r1 = await compiler.compile({ userQuery: "hello", conversationHistory: [], previouslyLoadedL1: new Set(), turnId: "t1" });
console.log("L0 tokens:", r1.tokenUsage.l0Tokens);   // ~200
console.log("L1 tokens:", r1.tokenUsage.l1Tokens);   // 0（无相关资源）

// Turn 2：相关 query + sticky
const r2 = await compiler.compile({ userQuery: "search the web", conversationHistory: [], previouslyLoadedL1: new Set(["tool:web_search"]), turnId: "t2" });
console.log("L1 tokens:", r2.tokenUsage.l1Tokens);   // >0（web_search 晋升）
```

#### 4. 验证 JSONL Trace 输出

运行任何 `Pace.run()` 后，检查 `.pace/traces/` 目录：

```bash
cat .pace/traces/task-*.jsonl | head -20
```

每行一个 JSON 事件：
```json
{"type":"RESOURCE_LOADED","timestamp":1708700259000,"resourceId":"tool:web_search","level":"L0","tokens":45}
{"type":"RESOURCE_LOADED","timestamp":1708700259001,"resourceId":"tool:web_search","level":"L1","tokens":120}
{"type":"LLM_CALL_START","timestamp":1708700259002,"tokens":{"context":312,"budget":3200}}
{"type":"LLM_CALL_END","timestamp":1708700260500,"tokens":{"input":312,"output":85},"latencyMs":1498}
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

### v0.2 — Phase 2：安全与终止 🔜

- [ ] SecurityController（S0 规则引擎：风险级别自动评估）
- [ ] TerminationController（BudgetStop、RetryStop、StagnationStop）
- [ ] 工具执行循环（处理 `finishReason === "tool_calls"`）
- [ ] FileMemoryProvider
- [ ] Anthropic 适配器

### v0.3 — Phase 3：生态扩展

- [ ] 多 Agent 编排（manager-worker 模式）
- [ ] MCP 工具桥
- [ ] LLM 辅助相关性评分
- [ ] Redis / SQLite 记忆 Provider
- [ ] `pace.config.yaml` 配置文件加载
- [ ] HTML 可观测性 Dashboard

---

## License

MIT
