# Pace — 渐进式 Agent 运行时框架

> Progressive Agent Computing Engine

## 〇、原始 PRD 问题分析

在原始 AI 生成的 PRD（`Pace.md`）基础上，识别出以下需修正的问题：

| # | 问题 | 说明 |
|---|------|------|
| 1 | **MVP 范围过大** | 原文 MVP 包含了安全控制器（S0+S1）、终止控制器（4种停机策略）、Memory 系统、Skill 系统、工具运行时，几乎是全功能。真正的 MVP 应只证明核心价值——渐进式加载能显著降低 token 消耗 |
| 2 | **缺少开发者体验（DX）设计** | 没有定义用户如何创建一个 agent、如何注册工具、如何启动运行——即没有 API 设计 |
| 3 | **ContextCompiler 机制模糊** | "编译最小必要上下文块"是文档中最核心的创新点，但具体怎么做（基于什么信号决定加载什么级别）没有说清楚 |
| 4 | **agentskills.io 引用不明** | 多次提到"遵循 agentskills.io"，但这不是一个广泛认知的标准，需要明确我们自己的 Skill 规范还是依赖外部 |
| 5 | **LLM 集成方式未定义** | 框架和 LLM 的交互方式（直接调 API？包装 provider？用户自带 client？）完全没提 |
| 6 | **验收指标无法测量** | "token 成本下降 ≥ 40%"需要 baseline 对照实验，但没有定义 baseline 是什么、测试场景是什么 |
| 7 | **Phase 划分耦合严重** | Phase 2（Memory+Skill）和 Phase 3（Tool）其实都是 ResourceProvider 的不同实现，应该按依赖关系重排 |
| 8 | **多 Agent 协作过早出现** | 原文 4.2 把"多 Agent 协作"列为 MVP 核心场景，但多 Agent 编排复杂度远超单 Agent 运行时，应明确为 v0.2 |

---

## 一、项目定位

### 1.1 一句话定义

**Pace** 是一个 Node.js/TypeScript Agent 运行时框架，通过资源分层（L0/L1/L2）渐进式加载，让 Agent 在保持能力的同时大幅降低上下文消耗。

### 1.2 核心问题

当前 Agent 开发面临四个结构性问题：

| 问题 | 表现 | 根因 |
|------|------|------|
| **上下文膨胀** | 工具描述、记忆、技能说明全量注入，单轮对话轻松突破 100k tokens | 没有"按需加载"机制，一切都是全量 |
| **重复上下文** | 多轮对话中重复注入相同背景信息 | 没有持久化摘要和命中缓存 |
| **失控执行** | Agent 反复重试失败操作、尝试危险命令 | 没有框架级的终止和安全策略 |
| **不可观测** | 不知道 token 花在哪、哪些上下文有用、哪些浪费 | 没有 trace 和指标体系 |

### 1.3 核心主张

**"给 Agent 一个有纪律的运行时"**——不是让 Agent 能力更强，而是让 Agent 运行得更省、更安全、更可控。

### 1.4 与竞品的关系

| 项目 | Pace 的定位 |
|------|-------------|
| LangChain / LlamaIndex | 它们是编排层，Pace 是运行时层。Pace 可以作为它们的 runtime 被嵌入 |
| Mastra / CrewAI | 它们关注多 Agent 编排工作流，Pace 关注单 Agent 的资源效率和安全 |
| Vercel AI SDK | 它是 LLM 调用的 SDK，Pace 在其之上管理上下文和执行策略 |
| MCP | MCP 是工具协议，Pace 的 ToolProvider 可以桥接 MCP |

---

## 二、产品目标

### 2.1 核心目标（按优先级）

1. **渐进式加载（Progressive Loading）**
   所有资源（工具、记忆、技能、文档）统一为 L0/L1/L2 三层，默认只加载最轻层（L0 索引），按需逐级展开。

2. **可观测（Observability）**
   每次资源加载、工具调用、策略决策都产出结构化 trace 事件，可量化 token 消耗和上下文效率。

3. **安全执行（Safe Execution）**
   有副作用的操作通过 ActionContract 描述，按风险分级拦截或审批。

4. **智能终止（Smart Termination）**
   预算耗尽、重复错误、无进展时自动停机并输出结构化的失败报告。

5. **可插拔（Pluggable）**
   安全策略、终止策略、资源提供者、LLM 适配器全部可替换。

### 2.2 非目标

- 不做可视化工作流编排器
- 不做多 Agent 编排（v0.1 仅单 Agent；v0.2 考虑）
- 不自建向量库/RAG（通过 Provider 接入）
- 不绑定特定 LLM 提供商
- 不做 prompt 工程库

---

## 三、用户与场景

### 3.1 目标用户

**Node.js/TypeScript 开发者**，正在构建或已有 Agent 应用，遇到以下痛点之一：
- 上下文 token 消耗过高，影响成本和延迟
- Agent 执行不可控（重试、危险操作）
- 工具/技能多了以后管理混乱
- 想量化 Agent 的效率但缺乏观测手段

### 3.2 MVP 必须覆盖的场景

| # | 场景 | 用户故事 | 关键验证点 |
|---|------|----------|------------|
| S1 | 工具目录渐进加载 | 作为开发者，我注册了 30 个工具，Agent 每轮对话只需看到相关工具的摘要，而非全量 schema | L0 索引 < 2k tokens；按需展开 L1/L2 |
| S2 | 记忆按需注入 | 作为开发者，我的 Agent 有长期记忆，每轮对话只注入与当前话题相关的记忆片段 | 相比全量注入，token 消耗显著下降 |
| S3 | 预算控制与停机 | 作为开发者，我不想 Agent 在一个任务上烧超过 N 个 token | token 超限或重复错误时自动停机 |
| S4 | 执行安全拦截 | 作为开发者，Agent 调用文件删除/数据库写入时需要我确认 | 高危操作被拦截并请求审批 |
| S5 | 运行可观测 | 作为开发者，我想看到每次 LLM 调用注入了哪些资源、花了多少 token | JSONL trace 完整记录所有事件 |

### 3.3 非 MVP 场景（v0.2+）

- 多 Agent 协作与共享事实层
- HTTP 远端工具
- MCP 工具桥接
- 可视化 Dashboard
- LangChain/LlamaIndex 集成封装

---

## 四、核心概念

### 4.1 Resource（统一资源模型）

Pace 的核心抽象：**一切可注入上下文的东西都是 Resource**。

```
Resource 类型：
├── Tool      — 可执行的工具（函数/HTTP/MCP/Shell）
├── Memory    — 持久化记忆（偏好/项目状态/临时日志）
├── Skill     — 能力描述（SKILL.md 格式）
└── Document  — 参考文档/RAG 检索结果
```

### 4.2 三层协议（L0 / L1 / L2）

这是 Pace 的核心创新——所有 Resource 统一遵循三层渐进式披露协议：

| 层级 | 名称 | 内容 | Token 量级 | 注入时机 |
|------|------|------|-----------|----------|
| **L0** | Index | 名称 + 一句话描述 + 标签 + 风险等级 | ~20-50 tokens/项 | 默认注入（目录） |
| **L1** | Preview | 参数摘要 + 用法示例 + 约束说明 | ~100-300 tokens/项 | LLM 判断需要时加载 |
| **L2** | Payload | 完整 schema / 全文 / 执行结果 | ~500-5000 tokens/项 | 确认必要才加载 |

**关键规则**：
- 默认只注入所有资源的 L0
- L1 由 LLM 请求或 ContextCompiler 基于相关性判断触发
- L2 仅在实际执行前加载（工具调用、引用全文）
- 每次 L2 加载必须携带用途说明（用于计算 hit/miss 指标）

### 4.3 ActionContract（动作契约）

所有有副作用的操作在执行前，必须结构化为 ActionContract：

```typescript
interface ActionContract {
  domain: 'fs' | 'git' | 'db' | 'net' | 'shell' | 'custom'
  operation: 'read' | 'write' | 'delete' | 'exec'
  target: string        // 规范化的资源路径
  impact: {             // 预估影响面
    scope: 'single' | 'batch' | 'global'
    estimate?: string   // "3 files", "~100 rows"
  }
  reversible: boolean   // 是否可回滚
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
}
```

---

## 五、架构设计

### 5.1 运行时模块

```
┌─────────────────────────────────────────────────┐
│                    Pace Runtime                  │
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
│  │            Tracer (Observability)         │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │         LLM Adapter (可插拔)              │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### 5.2 模块职责

| 模块 | 职责 | MVP 是否必须 |
|------|------|:----------:|
| **ResourceRegistry** | 聚合所有 ResourceProvider，维护 L0 索引 | ✅ |
| **ContextCompiler** | 每次 LLM 调用前，基于 query + budget + 历史，编译最小必要上下文 | ✅ |
| **BudgetScheduler** | 跟踪 token 消耗，决定本轮可用预算，触发降级策略 | ✅ |
| **ToolRuntime** | 执行工具调用，回填结果到上下文 | ✅ |
| **SecurityController** | 评估 ActionContract，按策略放行/拦截/审批 | ✅ |
| **TerminationController** | 检测预算耗尽/重复错误/无进展，触发停机反思 | ✅ |
| **Tracer** | 记录所有事件到 JSONL，计算运行时指标 | ✅ |
| **LLMAdapter** | 适配不同 LLM 提供商的调用接口 | ✅ |

### 5.3 ContextCompiler 详细设计

这是 Pace 的核心引擎，负责"做减法"。每次 LLM 调用前：

```
输入：
  - userQuery: string            // 当前用户输入
  - conversationHistory: Message[] // 对话历史（已压缩）
  - allResources: L0Index[]      // 所有资源的 L0 索引
  - budget: { maxTokens: number } // 本轮 token 预算
  - previousLoadDecisions: LoadTrace[] // 之前的加载决策（用于避免重复）

处理：
  1. Token 预算分配：预留 reply 空间 → 计算可用于 context 的 token 数
  2. L0 全量注入：将所有资源的 L0 索引注入（通常很小）
  3. 相关性判断：基于 userQuery + conversationHistory，标记可能相关的资源
  4. L1 按需加载：对标记为相关的资源，加载 L1 摘要
  5. L2 按需加载：仅当资源被明确请求时（如 LLM 输出 "need_detail: toolX"）
  6. Token 裁剪：如果总量超预算，按优先级裁剪（最近使用 > 相关性高 > 其他）

输出：
  - contextBlocks: ContextBlock[] // 编译后的上下文块列表
  - loadDecisions: LoadTrace[]    // 本次加载决策记录
  - tokenUsage: { context: number, available_for_reply: number }
```

**相关性判断策略（MVP 使用规则版，后续可升级为 LLM 判断）**：
- 关键词匹配：query 中的关键词与 L0 标签/名称匹配
- 历史命中：上一轮已加载到 L1/L2 的资源，本轮保持（除非话题切换）
- 工具链推断：如果上一步调用了工具 A，工具 A 声明的关联工具也加载 L1

### 5.4 LLM 集成方式

Pace 不直接调用 LLM API，而是通过 **LLMAdapter** 接口让用户注入自己的 LLM 客户端：

```typescript
interface LLMAdapter {
  // 发送消息并获取回复
  chat(params: {
    messages: Message[]
    tools?: ToolDefinition[]    // L2 级别的工具定义
    maxTokens?: number
  }): Promise<LLMResponse>

  // 估算 token 数量（用于预算控制）
  estimateTokens(text: string): number
}
```

框架内置提供：
- `OpenAIAdapter` — 适配 OpenAI 兼容 API（覆盖 OpenAI / Azure / 各类国产模型）
- `AnthropicAdapter` — 适配 Anthropic Claude API
- 用户可自行实现 `LLMAdapter` 接口

---

## 六、记忆体系

### 6.1 生命周期分层

| 层级 | 内容 | 生命周期 | 示例 |
|------|------|----------|------|
| **P0** | 用户偏好/身份/固定配置 | 永久 | "用户偏好 TypeScript"、"输出用中文" |
| **P1** | 活跃项目上下文 | 90 天（可配置） | "当前项目使用 Next.js 14"、"数据库是 PostgreSQL" |
| **P2** | 临时日志/调试信息 | 7 天（可配置） | 工具调用结果、中间推理步骤 |

### 6.2 存储结构（MVP 使用文件系统）

```
.pace/
├── memory/
│   ├── .index.json          # L0 索引（所有记忆条目的目录）
│   ├── p0/                  # 永久记忆
│   │   ├── preferences.md
│   │   └── identity.md
│   ├── p1/                  # 项目记忆
│   │   ├── project-abc.md
│   │   └── project-abc.summary.json  # L1 摘要缓存
│   └── p2/                  # 临时记忆
│       └── session-xxx.jsonl
```

### 6.3 记忆与渐进式加载的结合

- **L0**：`.index.json` 中每条记忆的 name + 一句话描述 + P 级别 + 最近访问时间
- **L1**：`.summary.json` 摘要缓存（首次生成后持久化，避免每次用 LLM 现总结）
- **L2**：完整记忆文件内容

---

## 七、工具体系

### 7.1 工具定义

开发者通过 `defineTool` 注册工具：

```typescript
const searchTool = defineTool({
  name: 'web_search',
  description: 'Search the web for information',  // 用于 L0
  tags: ['search', 'web', 'query'],
  risk: 'low',

  // L1: 参数摘要（自动从 schema 生成，也可手写覆盖）
  preview: 'Params: query(string, required), maxResults(number, default 10)',

  // L2: 完整参数 schema
  parameters: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().default(10),
  }),

  execute: async (params) => {
    // 实际执行逻辑
    return { results: [...] }
  },

  // 安全声明（可选）
  actionContract: {
    domain: 'net',
    operation: 'read',
    reversible: true,
    riskLevel: 'low',
  }
})
```

### 7.2 工具类型（按阶段实现）

| 类型 | 说明 | 版本 |
|------|------|------|
| **FunctionTool** | 本地 JS/TS 函数 | v0.1 (MVP) |
| **HTTPTool** | 远端 HTTP API | v0.2 |
| **MCPTool** | MCP 协议桥接 | v0.3 |
| **ShellTool** | Shell 命令（必须通过安全层） | v0.2 |

---

## 八、安全体系

### 8.1 安全检查分层

| 层级 | 成本 | 方式 | MVP |
|------|------|------|:---:|
| **S0** | 零成本 | 规则匹配：黑名单路径、危险命令模式、SQL 无 WHERE 检测 | ✅ |
| **S1** | 低成本 | dry-run、影响面估算（文件数/行数） | 部分 |
| **S2** | 高成本 | LLM 二次审核 | ❌ v0.2 |

### 8.2 安全配置（Security Profiles）

| Profile | 行为 | 适用场景 |
|---------|------|----------|
| **open** | 全部放行，仅记录日志 | 本地开发沙盒 |
| **balanced**（默认） | 低风险自动放行，中风险需确认，高风险拒绝 | 正常使用 |
| **strict** | 几乎所有写操作都需确认 | 生产环境 |

---

## 九、终止与反思

### 9.1 停机触发器

| 触发器 | 条件 | 默认阈值 |
|--------|------|----------|
| **BudgetStop** | 累计 token 超限 | 单任务 20k tokens |
| **RetryStop** | 同类错误重复 | 2 次 |
| **StagnationStop** | 连续 checkpoint 无进展 | 3 次 |
| **RiskStop** | 安全拦截次数过多 | 2 次 |

### 9.2 停机行为

停机 ≠ 退出。进入 Reflect Mode：

1. 生成结构化 **Failure Report**（原因 + 已完成的部分 + 卡住的位置）
2. 提供 **Next Options**（补充信息 / 换策略 / 降级目标 / 放弃）
3. 暂停自动循环，等待用户决策

---

## 十、可观测性

### 10.1 Trace 事件（JSONL 格式）

```typescript
type TraceEvent =
  | { type: 'LLM_CALL_START'; tokens: { context: number; budget: number } }
  | { type: 'LLM_CALL_END'; tokens: { input: number; output: number }; latencyMs: number }
  | { type: 'RESOURCE_LOADED'; resourceId: string; level: 'L0' | 'L1' | 'L2'; tokens: number }
  | { type: 'TOOL_INVOKED'; toolName: string; success: boolean; latencyMs: number }
  | { type: 'POLICY_DECISION'; action: string; decision: 'allow' | 'deny' | 'approve'; reason: string }
  | { type: 'STOP_TRIGGERED'; reason: string; trigger: string }
  | { type: 'CHECKPOINT'; summary: string; progress: number }
```

### 10.2 核心指标

| 指标 | 计算方式 | 目标 |
|------|----------|------|
| **Context Efficiency** | 被使用的 L1/L2 tokens / 总注入 tokens | > 60% |
| **Token per Task** | 完成任务的总 token 消耗 | 对比全量注入下降 ≥ 40% |
| **L2 Hit Rate** | 加载 L2 后实际被使用的比例 | > 70% |
| **Stop Effectiveness** | 停机后用户选择"有效"的比例 | > 50% |

---

## 十一、开发者体验（DX）

### 11.1 最小可用示例

```typescript
import { Pace, OpenAIAdapter, FileMemoryProvider } from '@pace/core'

const agent = new Pace({
  llm: new OpenAIAdapter({ model: 'gpt-4o' }),

  resources: [
    new FileMemoryProvider({ dir: '.pace/memory' }),
    searchTool,
    calculatorTool,
  ],

  budget: {
    maxTokensPerTask: 20_000,
    maxTokensPerTurn: 4_000,
  },

  security: 'balanced',  // 或 'open' | 'strict' | 自定义 SecurityPolicy

  termination: {
    maxRetries: 2,
    maxStagnation: 3,
  },
})

// 运行一次对话
const result = await agent.run('帮我查一下最近的 Node.js 安全公告')
console.log(result.reply)
console.log(result.trace)  // TraceEvent[]
console.log(result.tokenUsage)  // { input, output, context, total }
```

### 11.2 配置文件

支持 `pace.config.ts` 或 `pace.config.yaml`：

```yaml
# pace.config.yaml
llm:
  provider: openai
  model: gpt-4o

budget:
  maxTokensPerTask: 20000
  maxTokensPerTurn: 4000

security: balanced

termination:
  maxRetries: 2
  maxStagnation: 3

memory:
  provider: file
  dir: .pace/memory

trace:
  output: .pace/traces/
  format: jsonl
```

---

## 十二、技术栈

| 用途 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js 20+ | LTS，原生 ESM，用户群体匹配 |
| 语言 | TypeScript 5.x | 类型安全，接口定义清晰 |
| 包管理 | pnpm | workspace 支持好，适合 monorepo |
| 构建 | tsup | 零配置，输出 ESM + CJS |
| Schema 校验 | zod | 运行时校验 + 类型推导一体 |
| 配置解析 | yaml + zod | 用户友好 + 类型安全 |
| 日志/Trace | pino | 高性能 JSONL 输出 |
| 测试 | vitest | 快速，与 TypeScript 原生集成 |
| Token 估算 | tiktoken (可选) | 精确估算；备选粗估算 (chars/4) |

### 包结构（Monorepo）

```
packages/
├── core/           # 核心运行时：Registry, Compiler, Scheduler, Tracer
├── security/       # SecurityController + 内置策略
├── termination/    # TerminationController + 内置停机器
├── memory-file/    # FileMemoryProvider
├── llm-openai/     # OpenAI Adapter
├── llm-anthropic/  # Anthropic Adapter
└── cli/            # CLI 演示工具
```

---

## 十三、MVP（v0.1）规范

### 13.1 MVP 目标

**用最小范围验证核心假设：渐进式加载能显著降低 Agent 的上下文 token 消耗，同时不损失任务完成质量。**

### 13.2 MVP 包含

| 模块 | 范围 |
|------|------|
| **@pace/core** | ResourceRegistry + ContextCompiler（规则版相关性判断） + BudgetScheduler + Tracer |
| **FunctionToolProvider** | 本地 JS/TS 函数工具，支持 L0/L1/L2 |
| **FileMemoryProvider** | 文件系统记忆，支持 P0/P1 + L0 索引 + L1 摘要缓存 |
| **SecurityController** | S0 规则拦截（黑名单/危险模式） + Balanced 默认策略 |
| **TerminationController** | BudgetStop + RetryStop（2 种停机器 + Reflect 输出） |
| **LLMAdapter** | OpenAI 兼容适配器（覆盖大多数 LLM 提供商） |
| **Tracer** | JSONL 文件输出 + 基础指标计算 |
| **CLI Demo** | 命令行交互演示 |

### 13.3 MVP 不包含

- 多 Agent 编排 / shared-memory
- HTTP 工具 / MCP 工具 / Shell 工具
- S1 dry-run 安全检查 / S2 LLM 审核
- StagnationStop（无进展检测需要更复杂的实现）
- Anthropic Adapter（用户可自行实现接口）
- 可视化 Dashboard
- 配置文件加载（MVP 阶段用代码配置）

### 13.4 MVP 验收标准

**功能验收**：

| # | 验收项 | 验证方式 |
|---|--------|----------|
| F1 | 注册 20+ 个工具后，单轮上下文中工具描述 token < 2000 | trace 输出验证 |
| F2 | 工具在需要时能正确从 L0 升级到 L1/L2 | demo 场景 + trace |
| F3 | 记忆按相关性注入而非全量注入 | 对比测试 |
| F4 | token 超限时自动停机并输出 Failure Report | 设置低阈值触发 |
| F5 | 同类错误重复 2 次自动停机 | 构造失败场景 |
| F6 | 危险工具调用被 S0 规则拦截 | 构造危险操作场景 |
| F7 | 所有事件写入 JSONL trace 文件 | 检查 trace 文件完整性 |

**性能验收**：

| 指标 | 目标 |
|------|------|
| 20 个工具场景，L0 总 token | < 1500 tokens |
| 对比全量注入，token 节省 | ≥ 40% |
| ContextCompiler 编译耗时 | < 50ms（不含 LLM 调用） |
| Trace 写入对主流程的延迟影响 | < 5ms |

**工程验收**：

- 单元测试覆盖率 ≥ 80%（核心模块）
- 所有公开 API 有 TypeScript 类型定义
- README + Quickstart 文档
- 至少 1 个完整 demo 场景

---

## 十四、开发计划

### Phase 0：协议定义 + 项目脚手架

**目标**：定义所有核心接口和类型，初始化项目工程。

交付物：
- [ ] TypeScript 接口定义：Resource、L0/L1/L2 协议、ActionContract、TraceEvent、LLMAdapter、配置 Schema
- [ ] Monorepo 初始化：pnpm workspace + tsup + vitest + eslint
- [ ] `@pace/core` 包骨架
- [ ] CI：lint + test + build

### Phase 1：渐进式加载核心

**目标**：跑通 ResourceRegistry → ContextCompiler → LLM 调用的完整链路。

交付物：
- [ ] ResourceRegistry：注册 Provider、聚合 L0 索引
- [ ] ContextCompiler：基于规则的相关性判断 + token 预算裁剪
- [ ] BudgetScheduler：token 跟踪和预算分配
- [ ] Tracer：事件记录 + JSONL 输出
- [ ] LLMAdapter（OpenAI 兼容）
- [ ] 最小 demo：注册几个 mock 资源，跑通一轮对话，验证 L0→L1→L2 流程

### Phase 2：工具 + 记忆

**目标**：接入真实的工具和记忆，验证渐进式加载的实际效果。

交付物：
- [ ] FunctionToolProvider：defineTool API + L0/L1/L2 支持
- [ ] ToolRuntime：执行工具 + 结果回填
- [ ] FileMemoryProvider：文件读写 + .index.json + .summary.json
- [ ] 完整 demo：注册 20+ 工具 + 记忆，验证 token 节省

### Phase 3：安全 + 终止

**目标**：加入安全拦截和自动停机，让 Agent 运行可控。

交付物：
- [ ] SecurityController：S0 规则引擎 + Balanced 策略 + CLI 审批交互
- [ ] TerminationController：BudgetStop + RetryStop
- [ ] Reflector：Failure Report 生成 + Next Options
- [ ] 安全 demo：危险操作拦截场景
- [ ] 停机 demo：预算耗尽 + 重复错误停机场景

### Phase 4：打磨 + 发布 v0.1

**目标**：文档、测试、边界情况处理，达到可发布状态。

交付物：
- [ ] 单元测试补全（覆盖率 ≥ 80%）
- [ ] README + Quickstart + API 文档
- [ ] npm 包发布配置
- [ ] CHANGELOG
- [ ] 性能验收测试

---

## 十五、后续版本规划

### v0.2

- 多 Agent 编排（manager-worker 模式）
- shared-memory 跨 Agent 共享事实层
- HTTPToolProvider + ShellTool
- StagnationStop（无进展检测）
- S1 安全检查（dry-run / 影响面估算）
- Security Profiles 完整化（Open/Balanced/Strict 可配置切换）
- Anthropic Adapter
- 配置文件加载（pace.config.yaml）

### v0.3

- MCP 工具桥接
- Redis / SQLite MemoryProvider
- LangChain / Vercel AI SDK 集成封装
- ContextCompiler 升级：LLM 辅助相关性判断
- 基础 Dashboard（HTML 报告）
- S2 安全检查（LLM 二次审核）
