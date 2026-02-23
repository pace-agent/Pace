# PRD：Progressive Agent Framework（代号：PRAF）

## 1. 背景与问题

自驱 Agent 进入“会干活”的阶段后，系统性问题集中爆发：

*   **成本爆炸**：上下文越积越大、记忆全量注入、工具全量注入，导致 token 断崖式增长。
*   **协作失效**：多 Agent 互相“失明”，重复 onboarding，事实不能共享。
*   **安全事故**：自驱 agent 为达目标会试探边界、乱试命令，造成删库删代码等不可逆副作用。
*   **不停机**：自驱 agent 不知道停，错误反复重试，陷入无进展循环，浪费大量 token 与时间。

## 2. 产品目标（Goal）

做一个运行时级 Agent 框架，核心特性是：

*   **Progressive Loading（渐进式加载）**：任何资源（skills/记忆/工具/文档/跨 agent 产物）统一为 L0/L1/L2 分层，按需加载，默认只加载最轻层。
*   **Progressive Permission（渐进式授权）**：行动权限按风险与可回滚性分层，默认不打断，遇高危才升级审批。
*   **Stop & Reflect（会停会回头）**：框架级终止与反思机制，避免死磕和无限循环。
*   **Observability（可观测）**：每次加载/执行/拦截都有 trace，可量化节省与稳定性提升。
*   **可插拔（Pluggable）**：安全层/停机层/资源层都可插拔，支持从“全放通”到“最严格”。

## 3. 非目标（Non-Goal）

*   不做可视化工作流编排器（不做 DSL/图编辑器，至少 v1 不做）。
*   不试图替代 LangChain/LlamaIndex 等编排生态（我们提供 runtime，可被它们调用/嵌入）。
*   不自建复杂向量库/RAG 平台（以 provider/adapter 方式接入）。
*   不承诺“绝对安全”（承诺默认安全与可回滚/可审计）。

## 4. 用户画像与场景

### 4.1 强痛用户（优先）

*   **多工具、多系统**：DevOps、数据、运营、内部平台巡检
*   **多 Agent 协作**：经理-执行者、写作-研发-法务-财务等
*   **长任务**：跨天/跨周的项目型工作
*   **预算敏感**：token 成本、执行时间、事故成本

### 4.2 核心场景（MVP 必须覆盖）

*   **长对话写作/研发**：偏好记忆不重复、背景按需注入
*   **多工具任务**：工具目录很大，仍保持低 token
*   **多 Agent 协作**：共享事实层，避免互相失明
*   **安全动作拦截**：高危写删动作有计划/审批/回滚
*   **无进展自动停机**：错误重复与无进展检测触发停机反思

## 5. 方案总览：框架架构

### 5.1 核心概念：Resource（统一资源模型）

把以下全部视为 Resource：

*   Skill（遵循 agentskills.io：SKILL.md）
*   Memory（P0/P1/P2 分层文件 or DB）
*   Tool（函数/HTTP/MCP/脚本）
*   Docs/RAG（检索结果）
*   Agent Outputs（shared-memory/cross-agent-log、artifact 索引）

统一协议（L0/L1/L2）：

*   **L0 Index**：目录卡片（name/desc/tags/cost/risk/loc）
*   **L1 Preview**：摘要/参数摘要/示例/限制
*   **L2 Payload**：全文片段/完整 spec/执行结果/大段引用

### 5.2 运行时关键模块

*   **ResourceRegistry**：聚合多种 ResourceProvider
*   **ContextCompiler**：每次 LLM 调用前编译“最小必要上下文块”
*   **BudgetScheduler**：按 token/latency/risk/进展做决策（规则版起步）
*   **ToolRuntime**：执行工具并回填结果；写入共享事实层
*   **SecurityController（可插拔）**：策略栈 + 沙盒 + 审批 + 可回滚
*   **TerminationController（可插拔）**：预算停机 + 重试停机 + 无进展停机 + 反思模式
*   **Observability**：trace + 指标（token、latency、hit/miss、拦截次数）

## 6. 核心机制设计

### 6.1 渐进式加载（Progressive Loading）

**输入**

*   user query + session state（短上下文）
*   L0 索引（skills/memory/tools/docs）
*   budgets（token/latency）
*   policy（安全/停机策略）

**输出**

*   本轮注入的 context blocks（L0/L1/L2）
*   下一步 action（preview/load/invoke）
*   trace events

**关键规则（默认 Balanced）**

1.  默认只注入 L0（目录级）
2.  缺口驱动加载 L1（摘要/参数摘要）
3.  只有确认必要才加载 L2（全文片段/完整 schema/执行）
4.  任何 L2 都需有“用途说明”，否则视为浪费（用于 hit/miss）

### 6.2 记忆体系（Memory）

**生命周期：P0/P1/P2**

*   **P0**：用户偏好/身份/写作风格（永久）
*   **P1**：活跃项目状态（90 天或自定义）
*   **P2**：临时日志/调试细节（30 天或自定义）

**存储默认：文件系统（开箱即用）**

*   `memory/`：个人/agent 记忆
*   `shared-memory/`：跨 agent 共享事实层（只记结论）
*   `.abstract`：L0 索引
*   `*.summary.json`（或 md）：L1 摘要缓存（避免每次用 LLM 现总结）

可选：Redis / Postgres / SQLite Provider

### 6.3 Skill 体系（遵循 Agent Skills）

**Skill 包**：`SKILL.md` + 可选 `resources/scripts`

*   **启动注入**：只加载 frontmatter（name/desc/loc）= L0
*   **激活加载**：加载 SKILL.md body = L2
*   **resources**：按需加载（脚本/参考资料）

这保证 skill 的本质就是渐进式披露。

### 6.4 工具体系（Tool Runtime）

**工具分为：**

*   本地函数工具（JS/TS）
*   HTTP 工具
*   MCP bridge 工具（后置）
*   Shell 工具（必须通过沙盒与 ActionContract）

**工具调用流程：**

1.  **L0**：仅暴露卡片（name/desc/tags/risk/cost）
2.  **需要时 L1**：参数摘要 + 示例
3.  **真调用前 L2**：完整 schema（或参数约束）+ 安全评估

### 6.5 安全（SecurityController，可插拔）

**核心：ActionContract（通用动作描述）**

每次可能有副作用的动作，必须先结构化为 action：

*   `domain`: fs/git/db/net/cloud/custom
*   `operation`: read/write/delete/exec/deploy/commit…
*   `target`: 规范化资源
*   `impact`: 预估影响面（diffLines/files/rows）
*   `reversible`: 是否可回滚（patch/PR/txn）
*   `requiresSecrets`: 是否需要密钥
*   `riskHints`: 工具自报风险

**策略层：Security Profiles**

*   **Open**：全放通（建议仅本地沙盒）
*   **Balanced**：可逆自动，高危审批
*   **Strict**：几乎所有副作用都要计划/审批

**机制（默认 Balanced）**

*   风险分级 + 可回滚优先
*   两阶段提交：Plan → Approve → Execute（只在高危/超额度触发）
*   配额（quota）：小改自动，大改升级审批
*   可回滚写入：Patch/PR/transaction（优先）
*   审计：全链路记录

**重要：安全检查分层 S0/S1/S2，避免 token 激增**

*   **S0（零成本）**：规则/黑名单/路径/SQL 语法
*   **S1（低成本）**：dry-run/explain/影响面估计
*   **S2（高成本，可选）**：LLM 审核/二号 agent 审核

### 6.6 会停与回头（TerminationController，可插拔）

**触发器**

*   **Budget Stop**：单轮/单任务 token、latency 超阈值
*   **Error Stop**：同类错误重复 N 次
*   **Stagnation Stop**：无进展连续 K 个 checkpoint
*   **Risk Stop**：安全拦截过多/越权试探

**停机行为（Reflect Mode）**

停机不等于结束：

1.  生成 Failure Report（极短）
2.  给 Next Options：补信息/换策略/降级目标
3.  停止自动循环（除非用户显式继续）

**默认 Balanced 参数（可调）**

*   同类错误重复：2 次停
*   无进展 checkpoint：3 次停
*   安全拦截：2 次停
*   单轮输出上限：600 tokens
*   单任务累计：8k–20k tokens（按场景）

## 7. 可观测（Observability）

### 7.1 Trace 事件模型（最小集）

*   `LLM_CALL_STARTED/ENDED`（token、latency）
*   `RESOURCE_INDEX_LOADED`（L0）
*   `RESOURCE_PREVIEW_LOADED`（L1）
*   `RESOURCE_PAYLOAD_LOADED`（L2）
*   `TOOL_INVOKED / TOOL_FAILED`
*   `POLICY_DENIED / POLICY_APPROVAL_REQUIRED`
*   `CHECKPOINT_EMITTED`
*   `STOP_TRIGGERED`（reason）
*   `REFLECT_REPORT_EMITTED`

### 7.2 核心指标（用来证明价值）

*   **Context Waste Ratio（浪费率）**
*   **Token per Useful Fact（有效信息单位成本）**
*   **Re-onboarding Frequency（重复介绍次数）**
*   **Tool-call Failure Rate（工具失败率）**
*   **Time-to-First-Correct（首次可用输出时间）**
*   **Stop-trigger rate（停机触发与原因）**

## 8. 配置与可插拔设计

### 8.1 插件点（必须）

*   **ResourceProviders**: File/Redis/DB/Vector/Skill
*   **SecurityMiddlewares**: StaticGuard/QuotaGuard/SandboxGuard/LLMReviewGuard
*   **TerminationMiddlewares**: RetryStopper/BudgetStopper/StagnationStopper/Reflector
*   **Orchestrators**: single-agent / manager-worker / round-robin（后续扩展）

### 8.2 配置形态（建议）

`praf.config.ts` 或 `praf.yaml`

*   **profiles**: Open/Balanced/Strict
*   **domain overrides**: fs/git/db/net 单独设置
*   **budgets**: token/latency/risk/step

## 9. 交付物清单（Deliverables）

### v0.1（MVP）

*   Runtime Core（ResourceRegistry + ContextCompiler + Scheduler）
*   FileMemoryProvider（含 .abstract + summary cache + P 标签）
*   SkillProvider（agentskills：SKILL.md）
*   FunctionToolProvider（本地工具）
*   SecurityController（S0+S1，默认 Balanced）
*   TerminationController（Budget+Retry+Stagnation+Reflect）
*   CLI Demo（单 agent）：展示 token 下降、停机反思、安全拦截
*   JSONL trace 输出 + 简易 report

### v0.2

*   shared-memory（跨 agent 共享事实层）
*   多 agent orchestrator（manager-worker）
*   HTTPToolProvider
*   policy profiles 完整化（Open/Balanced/Strict）
*   基础 dashboard（命令行/HTML report 都可）

### v0.3

*   RedisMemoryProvider（可选）
*   LangChain wrapper（最薄的一层：把 praf 作为 runtime/LLM wrapper 接入）
*   MCP bridge（可选）

## 开发计划（Node/TypeScript）

### 技术栈建议

*   **Node 20+**，**TypeScript**
*   **打包**：tsup / rollup
*   **包管理**：pnpm
*   **日志**：pino（JSONL）
*   **配置**：zod + yaml
*   **测试**：vitest
*   （可选）**token 估算**：tiktoken / 粗估算 fallback

### Phase 0：立项与规格（2–3 天）

目标：把“协议定死”，避免后续返工

*   定义 Resource 模型（L0/L1/L2）
*   定义 ActionContract（安全用）
*   定义 Trace 事件模型
*   定义配置 schema（profiles/overrides/budgets）
*   Repo 初始化 + CI（lint/test/build）
*   **交付**：spec.md + types.ts + 示例配置

### Phase 1：Runtime Core（4–6 天）

目标：跑通“渐进式加载”闭环（无安全也能跑）

*   ResourceRegistry（注册 provider、聚合索引）
*   ContextCompiler（编译 blocks，控制 token）
*   BudgetScheduler（规则版：L0→L1→L2）
*   Observability（trace 打点）
*   Demo CLI（无工具/无记忆也能跑）
*   **交付**：@praf/core 可用，跑一个最小对话

### Phase 2：Memory + Skill（5–7 天）

目标：真正解决“重复 onboarding”与“目录级加载”

*   FileMemoryProvider
*   .abstract 生成/读取
*   L1 摘要缓存（summary store）
*   P0/P1/P2 生命周期清理脚本（可先手动触发）
*   SkillProvider（读取 SKILL.md frontmatter 作为 L0）
*   shared-memory 目录规范（先结构+追加日志）
*   **交付**：单 agent 能在不重复自我介绍的情况下稳定完成任务

### Phase 3：Tool Runtime（4–6 天）

目标：工具也走渐进式（L0 卡片→ L1 preview → L2 调用）

*   FunctionToolProvider（本地函数）
*   HTTPToolProvider（远端）
*   ToolRuntime 执行与回填
*   Tool 结果写入 cross-agent-log（结论式）
*   **交付**：demo：先查数据工具，再生成报告

### Phase 4：安全（SecurityController 可插拔）（6–10 天）

目标：防删库删代码，且不频繁打断自驱

*   ActionContract 规范化 + 从工具调用生成 action
*   S0 静态拦截（黑名单/路径/SQL无where等）
*   S1 影响面评估（diff 行数/rows估计/dry-run）
*   Profiles：Open/Balanced/Strict
*   两阶段提交（Plan→Approve→Execute）机制（先 CLI approve）
*   审计日志（policy 决策与理由）
*   **交付**：demo：危险命令被拦截，给出 plan 并请求一次审批

### Phase 5：会停与回头（TerminationController 可插拔）（4–7 天）

目标：避免死磕，像人一样“错几次就停”

*   checkpoint 生成（结构化短摘要）
*   RetryStopper（按错误类型配额）
*   StagnationStopper（无进展检测：重复 blocker/重复 plan）
*   BudgetStopper（token/time）
*   Reflector（失败报告 + 下一步选项）
*   **交付**：demo：连续失败后自动停机输出“求助清单”

### Phase 6：多 Agent 协作（可选，v0.2）（7–14 天）

目标：manager-worker + 共享事实层

*   Orchestrator：manager-worker
*   shared-memory 写入规则（强制结论式）
*   cross-agent-log 的索引与摘要
*   观测：按 agent 维度统计 token 与效率
*   **交付**：demo：7 角色协作但共享事实不互盲

## 验收标准（Definition of Done）

### 核心指标（MVP）

在 10 个真实任务上，对比 baseline（全量注入）：

*   token 成本下降 ≥ 40%（强痛场景目标 ≥ 70%）
*   重复介绍次数下降 ≥ 50%
*   工具失败率下降 ≥ 30%
*   出现无进展时能在 ≤3 次循环内停机并输出清晰求助信息
*   危险写删动作在 Balanced/Strict 下不可直接执行（必须计划/审批/或拒绝）

### 工程指标

*   插件化：安全/停机/存储可开关
*   观测完整：每次 L0/L1/L2 加载、tool 调用、policy 决策都有 trace
*   文档：Quickstart + 2 个 demo + 配置说明
