# Pace

> Progressive Agent Computing Engine — AI Agent 的高纪律性运行时框架

Pace 是一个 Node.js/TypeScript Agent 运行时，通过渐进式资源加载（L0/L1/L2 三层协议）大幅降低上下文 token 消耗，同时提供内置安全策略、终止控制和完整可观测性。

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

每次资源加载、LLM 调用、工具执行、策略决策都会发出结构化 `TraceEvent`，写入 `.pace/traces/*.jsonl`。

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
    security: "balanced",          // "open" | "balanced" | "strict"
    termination: { maxRetries: 3, maxStagnation: 3, maxSecurityDenials: 2 },
  },
});

const result = await agent.run("搜索最新的 TypeScript release notes");
console.log(result.reply);
console.log(result.tokenUsage);
// { inputTokens: 312, outputTokens: 85, contextTokens: 282, totalTokens: 397 }

console.log(result.toolCallsExecuted); // 执行的工具调用次数
console.log(result.stopped);           // 是否被终止策略提前停止
console.log(result.trace);             // TraceEvent[]
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

## 使用 SecurityController

```typescript
import { SecurityController } from "@pace-agent/security";

const agent = new Pace({
  llm,
  resources: [myToolProvider],
  securityPolicy: new SecurityController({ profile: "strict" }),
});
```

---

## 使用 FileMemoryProvider

```typescript
import { FileMemoryProvider } from "@pace-agent/memory-file";

const memory = new FileMemoryProvider(".pace/memory");
await memory.init();   // 创建目录结构

const agent = new Pace({ llm, resources: [memory] });

// 写入记忆
const id = await memory.write(
  { name: "项目背景", description: "当前项目信息", priority: "P0", tags: ["project"] },
  "我们正在开发一个名为 Pace 的 TypeScript Agent 运行时。"
);
```

---

## 包结构

| 包 | 状态 | 说明 |
|----|------|------|
| `@pace-agent/core` | ✅ Phase 2 已完成 | 核心运行时：ResourceRegistry、ContextCompiler、BudgetScheduler、JsonlTracer、PaceRuntime（含工具执行循环） |
| `@pace-agent/llm-openai` | ✅ Phase 2 已完成 | OpenAI 兼容 LLM 适配器，支持 tool_calls |
| `@pace-agent/security` | ✅ Phase 2 已完成 | SecurityController：S0 规则引擎 + open/balanced/strict 三档 profile |
| `@pace-agent/termination` | ✅ Phase 2 已完成 | TerminationController：budget/retry/stagnation/risk 四种停止条件 + buildFailureReport() |
| `@pace-agent/memory-file` | ✅ Phase 2 已完成 | 基于文件系统的记忆 Provider，支持 p0/p1/p2 优先级分层和 TTL 过期 |
| `@pace-agent/cli` | ✅ Phase 1 已完成 | CLI 演示（含 token 节省对比） |

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
pnpm test         # 运行全部 71 个测试
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

---

## Phase 2 完成内容与验证

### 已完成能力

| 模块 | 能力 |
|------|------|
| **SecurityController** | S0 硬规则（shell exec / global delete / critical 无条件拒绝，不可逆 batch 升级审批）；open/balanced/strict 三档 profile；`evaluate()` 返回 `SecurityDecision`（allow/deny/approve） |
| **TerminationController** | 无状态 `shouldStop()` 检查 budget/retry/stagnation/risk；`buildFailureReport()` 生成结构化停止报告（trigger、summary、nextOptions）；所有阈值可在构造时配置 |
| **FileMemoryProvider** | `.index.json` 存储全部元数据；`p0/p1/p2` 子目录存储内容；TTL 过期自动过滤；同时实现 `ResourceProvider`（供 ContextCompiler 使用）和 `MemoryProvider`（供应用层操作） |
| **PaceRuntime 工具循环** | `finishReason=tool_calls` 时进入循环；每次工具调用前安全检查；执行结果注入为 `tool` 消息；终止策略在循环前后双重检查；`RunResult` 新增 `stopped`、`stopReason`、`toolCallsExecuted` 字段 |

### 验证方式

#### 1. 单元测试

```bash
pnpm test
```

预期输出：
```
 ✓ packages/core/src/registry/ResourceRegistry.test.ts     (6 tests)
 ✓ packages/core/src/budget/BudgetScheduler.test.ts        (7 tests)
 ✓ packages/core/src/trace/JsonlTracer.test.ts             (5 tests)
 ✓ packages/core/src/compiler/ContextCompiler.test.ts      (7 tests)
 ✓ packages/core/src/runtime/PaceRuntime.test.ts           (10 tests)
 ✓ packages/llm-openai/src/OpenAIAdapter.test.ts           (5 tests)
 ✓ packages/security/src/SecurityController.test.ts        (12 tests)
 ✓ packages/termination/src/TerminationController.test.ts  (8 tests)
 ✓ packages/memory-file/src/FileMemoryProvider.test.ts     (11 tests)

 Tests  71 passed (71)
```

#### 2. 验证终止策略

```typescript
import { TerminationController } from "@pace-agent/termination";

const ctrl = new TerminationController({ maxRetries: 3, budgetThreshold: 0.9 });

// 正常情况：返回 null
ctrl.shouldStop({ totalTokens: 5000, budgetTokens: 10000,
                  consecutiveErrors: 0, consecutiveStagnations: 0, securityDenials: 0 });
// → null

// 超出预算：返回 "budget"
ctrl.shouldStop({ totalTokens: 9500, budgetTokens: 10000,
                  consecutiveErrors: 0, consecutiveStagnations: 0, securityDenials: 0 });
// → "budget"

// 生成失败报告
const report = ctrl.buildFailureReport({
  reason: "budget",
  task: "分析代码仓库",
  completedSteps: ["读取文件列表", "分析 core 包"],
  stuckAt: "加载 llm-openai 包",
  tokenUsage: { total: 19000, budget: 20000 },
});
console.log(report.trigger);      // "Token usage reached 95% of budget"
console.log(report.nextOptions);  // ["Increase maxTokensPerTask ...", ...]
```

#### 3. 验证安全策略

```typescript
import { SecurityController } from "@pace-agent/security";

const ctrl = new SecurityController({ profile: "balanced" });

// Shell exec 无条件拒绝
await ctrl.evaluate({ domain: "shell", operation: "exec", target: "rm -rf /",
                      impact: { scope: "global" }, reversible: false, riskLevel: "critical" });
// → { allowed: false, action: "deny", reason: "S0: Shell exec denied" }

// low risk 自动通过
await ctrl.evaluate({ domain: "fs", operation: "read", target: "/tmp/file.txt",
                      impact: { scope: "single" }, reversible: true, riskLevel: "low" });
// → { allowed: true, action: "allow" }
```

#### 4. 验证工具执行循环

```typescript
// RunResult 现在包含工具执行信息
const result = await agent.run("搜索 TypeScript 5.4 的新特性");
console.log(result.toolCallsExecuted); // 实际执行的工具调用次数
console.log(result.stopped);           // false（正常完成）或 true（被终止策略停止）
console.log(result.stopReason);        // 如果 stopped=true："budget" | "retry" | "stagnation" | "risk"

// Trace 中可以看到工具调用事件
const toolEvents = result.trace.filter(e => e.type === "TOOL_INVOKED");
const policyEvents = result.trace.filter(e => e.type === "POLICY_DECISION");
```

#### 5. 验证文件记忆

```typescript
import { FileMemoryProvider } from "@pace-agent/memory-file";

const memory = new FileMemoryProvider(".pace/memory");
await memory.init();

// 写入
const id = await memory.write(
  { name: "用户偏好", description: "用户设置", priority: "P0", tags: ["prefs"], ttlDays: 30 },
  "用户偏好使用 TypeScript，喜欢简洁代码风格。"
);

// 读取（L0 索引）
const entries = await memory.list();
// → [{ id, name: "用户偏好", priority: "P0", ... }]

// 读取摘要（L1）
const summary = await memory.getSummary(id);

// 接入 Pace（ContextCompiler 会将其纳入相关性评分）
const agent = new Pace({ llm, resources: [memory] });
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

### v0.3 — Phase 3：生态扩展

- [ ] 多 Agent 编排（manager-worker 模式）
- [ ] MCP 工具桥
- [ ] LLM 辅助相关性评分
- [ ] Anthropic 适配器
- [ ] Redis / SQLite 记忆 Provider
- [ ] `pace.config.yaml` 配置文件加载
- [ ] HTML 可观测性 Dashboard

---

## License

MIT
