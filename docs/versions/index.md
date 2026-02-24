# Pace 版本迭代计划

> 本目录记录每次版本迭代前的设计文档和规划。

## 版本路线图

### v0.1 — 渐进式加载核心 (MVP) ✅

**状态**：已完成

**核心目标**：验证渐进式加载能显著降低 Agent 的上下文 token 消耗

**包含功能**：
- ResourceRegistry + ContextCompiler（规则版相关性判断）
- FunctionToolProvider + FileMemoryProvider
- SecurityController（S0 规则拦截）
- TerminationController（BudgetStop + RetryStop）
- OpenAI/Anthropic Adapter
- Tracer（JSONL 输出）

---

### v0.2 — 外部验证 + 基础沙箱

**状态**：规划中

**核心目标**：引入外部验证机制，让 Agent 任务完成更可靠；实现基础沙箱隔离

**包含功能**：

| 功能 | 优先级 | 描述 |
|------|--------|------|
| **外部验证机制** | P0 | `verifyCompletion` API，解决 LLM 自评估不可靠问题 |
| **Compaction 结构化摘要** | P0 | 借鉴 pi-mono，生成 Goal/Progress/Decisions 摘要 |
| **Guardrails 学习系统** | P1 | 从失败中积累规则，跨会话持久化 |
| **基础沙箱（文件级）** | P1 | 工作区隔离：cp → 修改 → diff → 合并 |
| **网络隔离（allow-list）** | P2 | 限制 Agent 可访问的域名 |
| **Extension 系统（基础）** | P2 | 事件订阅 + tool_call 拦截 |

**设计文档**：[v0.2/README.md](./v0.2/README.md)

---

### v0.3 — 完整沙箱 + Context Rotation

**状态**：规划中

**核心目标**：实现完整的沙箱隔离和上下文轮换机制

**包含功能**：

| 功能 | 优先级 | 描述 |
|------|--------|------|
| **OS 级沙箱** | P0 | Linux bubblewrap / macOS Seatbelt |
| **Secret Injection** | P0 | 按需注入凭证，避免暴露全部 |
| **Context Rotation** | P0 | 上下文轮换策略，状态持久化到文件系统 |
| **Git Worktree 集成** | P1 | 为 Agent 创建隔离的 git worktree |
| **LLM 辅助相关性判断** | P1 | 用轻量 LLM 判断 L1 加载，失败回退规则版 |
| **HTML Dashboard** | P2 | 可视化 token 消耗、资源加载瀑布图 |

**设计文档**：v0.3/（待创建）

---

### v0.4 — 多 Agent 编排

**状态**：规划中

**核心目标**：支持多 Agent 协作和 MCP 工具桥接

**包含功能**：

| 功能 | 优先级 | 描述 |
|------|--------|------|
| **多 Agent 编排** | P0 | manager-worker 模式 |
| **shared-memory** | P0 | 跨 Agent 共享事实层 |
| **MCP 工具桥接** | P1 | MCPToolProvider |
| **框架集成** | P2 | LangChain / LlamaIndex / Vercel AI SDK 封装 |

**设计文档**：v0.4/（待创建）

---

## 版本迭代流程

每次版本迭代遵循以下流程：

```
1. 设计阶段
   ├── 创建 docs/versions/v{version}/ 目录
   ├── 编写 README.md（设计文档）
   ├── 编写 API.md（接口设计）
   └── 编写 IMPL.md（实现计划）

2. 实现阶段
   ├── 创建 feature 分支
   ├── 按 IMPL.md 逐步实现
   └── 编写单元测试

3. 评审阶段
   ├── 代码审查
   ├── 测试覆盖率检查
   └── 文档更新

4. 发布阶段
   ├── 合并到 master
   ├── 更新 CHANGELOG
   └── 发布 npm 包
```

## 设计决策记录

重要设计决策记录在 `docs/decisions/` 目录：

- `ADR-001-external-verification.md` — 外部验证机制设计决策
- `ADR-002-sandbox-isolation.md` — 沙箱隔离设计决策
- `ADR-003-compaction-strategy.md` — Compaction 策略设计决策

（待创建）

---

## 相关文档

- [PRD.md](../PRD.md) — 产品需求文档
- [MEMORY.md](../../MEMORY.md) — 长期记忆（如果有）
