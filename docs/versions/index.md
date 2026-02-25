# Pace 版本迭代计划

本文档规划 Pace 框架的版本迭代路线图。

---

## 版本概览

| 版本 | 主题 | 状态 | 目标 |
|------|------|------|------|
| v0.1 | 渐进式加载核心 | ✅ 完成 | 验证 L0/L1/L2 能显著降低 token 消耗 |
| v0.2 | 外部验证 + 基础沙箱 | 🔜 计划中 | 解决 LLM 自评估不可靠问题 + 文件隔离 |
| v0.3 | 完整沙箱 + Context Rotation | 📋 规划中 | OS 级隔离 + 上下文轮换 |
| v0.4 | 多 Agent 编排 | 📋 规划中 | manager-worker 模式 + shared-memory |

---

## v0.1 — 渐进式加载核心（已完成）

**核心价值**：验证渐进式加载能显著降低 Agent 的上下文 token 消耗。

**已实现**：
- ResourceRegistry + ContextCompiler（规则版相关性判断）
- FunctionToolProvider + FileMemoryProvider
- SecurityController（S0 规则） + TerminationController（Budget + Retry）
- OpenAI Adapter + Anthropic Adapter + SQLite MemoryProvider
- LLM 辅助相关性评分

---

## v0.2 — 外部验证 + 基础沙箱

**核心价值**：
1. 解决 LLM 自评估不可靠问题（引入外部验证机制）
2. 实现文件级隔离（工作区模式）

**设计文档**：[v0.2-design.md](./v0.2-design.md)

### 功能模块

| 模块 | 优先级 | 说明 |
|------|--------|------|
| **TaskCompletion** | P0 | 外部可验证的完成标准 |
| **SandboxManager** | P0 | 工作区隔离（文件级） |
| **MergeManager** | P1 | diff 生成 + 审批流 |
| **Guardrails** | P1 | 从失败中学习规则 |

### 关键决策

1. **沙箱粒度**：v0.2 使用文件级（cp → 修改 → 合并）
2. **网络隔离**：v0.2 使用 allow-list 模式
3. **合并机制**：自动 diff + CLI 审批交互

---

## v0.3 — 完整沙箱 + Context Rotation

**核心价值**：
1. OS 级安全隔离
2. 上下文轮换避免 Context Rot

### 功能模块

| 模块 | 说明 |
|------|------|
| **OS Isolation** | bubblewrap（Linux）/ seatbelt（macOS） |
| **Network Proxy** | Unix socket + domain allow-list |
| **Context Rotation** | 上下文轮换策略 |
| **Secret Injection** | 按需注入凭证 |
| **Git Worktree 集成** | 多 agent 并行工作 |

---

## v0.4 — 多 Agent 编排

**核心价值**：支持 manager-worker 模式的多 Agent 协作。

### 功能模块

| 模块 | 说明 |
|------|------|
| **Agent Orchestrator** | 多 agent 编排器 |
| **Shared Memory** | 跨 agent 共享事实层 |
| **MCP Tool Bridge** | MCP 工具桥接 |
| **Framework Integration** | LangChain / Vercel AI SDK 封装 |

---

## 迭代原则

1. **慢就是快** — 认真做好每一次设计，不急于求成
2. **验证驱动** — 每个版本必须有明确的验证目标
3. **渐进增强** — 在稳定基础上逐步添加功能
4. **向后兼容** — 不破坏已有 API

---

## 文档规范

每个版本的迭代文档包含：

```
docs/versions/
├── index.md           # 版本总览（本文件）
├── v0.2-design.md     # v0.2 设计文档
├── v0.3-design.md     # v0.3 设计文档
└── v0.4-design.md     # v0.4 设计文档
```

每个设计文档的结构：

1. **目标** — 本版本要解决什么问题
2. **背景** — 为什么需要这个功能
3. **设计** — 详细的 API 和架构设计
4. **实现计划** — 分阶段实现步骤
5. **验收标准** — 如何验证功能正确性

---

*最后更新：2025-02-25*
