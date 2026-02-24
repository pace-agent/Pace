# v0.2 设计文档 — 外部验证 + 基础沙箱

> 版本目标：引入外部验证机制，让 Agent 任务完成更可靠；实现基础沙箱隔离

## 一、版本概述

### 1.1 核心目标

1. **外部验证机制** — 解决 LLM 自评估不可靠的问题
2. **Compaction 结构化摘要** — 更智能的上下文压缩
3. **Guardrails 学习系统** — 从失败中积累规则
4. **基础沙箱** — 文件级隔离 + 网络隔离

### 1.2 与 v0.1 的关系

v0.1 验证了渐进式加载的核心价值。v0.2 在此基础上增强：

| 维度 | v0.1 | v0.2 |
|------|------|------|
| **任务完成判断** | LLM 自评估 | 外部可验证标准 |
| **上下文压缩** | 无 | Compaction 结构化摘要 |
| **失败处理** | 停机 + 报告 | 停机 + 学习 + 持久化规则 |
| **安全隔离** | S0 规则拦截 | 文件级沙箱 + 网络隔离 |

### 1.3 设计原则

1. **慢就是快** — 认真设计，不走捷径
2. **渐进增强** — 在 v0.1 基础上扩展，不破坏现有 API
3. **可插拔** — 新功能通过配置开启，不影响现有用户

---

## 二、外部验证机制

### 2.1 问题分析

**v0.1 的问题**：
- LLM 自我评估完成时经常"差不多就停"
- 没有客观的完成标准
- 无法自动化验证任务是否真正完成

**Ralph Loop 的启发**：
- 用 `verifyCompletion` 函数定义外部可验证的完成标准
- 不依赖 LLM 的自我判断
- 支持最大迭代/token 限制

### 2.2 API 设计

```typescript
/**
 * 任务完成验证器
 */
interface TaskCompletionVerifier {
  /**
   * 验证任务是否完成
   * @returns 完成状态和原因
   */
  verifyCompletion(): Promise<VerificationResult>;

  /**
   * 获取当前进度描述（用于 trace 和用户反馈）
   */
  getProgress?(): Promise<string>;
}

interface VerificationResult {
  /** 是否完成 */
  complete: boolean;
  /** 原因说明 */
  reason: string;
  /** 未完成时的下一步建议 */
  nextSteps?: string[];
  /** 进度指标（可选） */
  progress?: {
    completed: number;
    total: number;
    unit: 'tasks' | 'files' | 'tests' | 'custom';
  };
}

/**
 * 任务配置扩展
 */
interface TaskConfig {
  // ... 现有配置 ...

  /**
   * 外部验证器（可选）
   */
  verifier?: TaskCompletionVerifier;

  /**
   * 最大迭代次数（默认 10）
   */
  maxIterations?: number;

  /**
   * 最大 token 消耗（默认 20000）
   */
  maxTokens?: number;

  /**
   * 迭代间延迟（毫秒，默认 1000）
   */
  iterationDelayMs?: number;
}
```

### 2.3 使用示例

```typescript
import { Pace, TaskCompletionVerifier } from '@pace/core';

// 定义验证器
const migrationVerifier: TaskCompletionVerifier = {
  async verifyCompletion() {
    const checks = await Promise.all([
      fileExists('vitest.config.ts'),
      !fileExists('jest.config.js'),
      noFilesMatch('**/*.test.ts', /from ['"]@jest/),
      fileContains('package.json', '"vitest"'),
    ]);

    const allPassed = checks.every(Boolean);

    return {
      complete: allPassed,
      reason: allPassed 
        ? 'Jest to Vitest migration complete' 
        : 'Structural checks failed',
      nextSteps: allPassed ? undefined : [
        'Create vitest.config.ts',
        'Remove jest.config.js',
        'Update test imports',
        'Add vitest to package.json',
      ],
      progress: {
        completed: checks.filter(Boolean).length,
        total: checks.length,
        unit: 'tasks',
      },
    };
  },

  async getProgress() {
    const result = await this.verifyCompletion();
    return `Migration: ${result.progress?.completed}/${result.progress?.total} checks passed`;
  },
};

// 使用验证器
const agent = new Pace({
  llm: new OpenAIAdapter({ model: 'gpt-4o' }),
  resources: [...],
  task: {
    verifier: migrationVerifier,
    maxIterations: 20,
    maxTokens: 50000,
  },
});

const result = await agent.run('Migrate from Jest to Vitest');
```

### 2.4 运行时行为

```
Agent 循环:
  1. 编译上下文（ContextCompiler）
  2. 调用 LLM
  3. 执行工具调用
  4. 检查终止条件（BudgetStop / RetryStop）
  5. 【新增】调用 verifier.verifyCompletion()
     - 如果 complete: true → 停机，返回成功
     - 如果 complete: false → 注入 nextSteps，继续下一轮
  6. 检查 maxIterations / maxTokens
     - 超限 → 停机，返回 Failure Report
  7. 等待 iterationDelayMs
  8. 继续下一轮
```

### 2.5 与 TerminationController 集成

```typescript
interface TerminationController {
  // ... 现有方法 ...

  /**
   * 检查是否应该停机（扩展）
   */
  shouldStop(context: TerminationContext): StopDecision;

  /**
   * 新增：外部验证结果
   */
  checkExternalVerification?(
    result: VerificationResult,
    iteration: number,
    tokensUsed: number
  ): StopDecision;
}

type StopDecision = 
  | { action: 'continue' }
  | { action: 'stop'; reason: string; trigger: StopTrigger }
  | { action: 'iterate'; nextSteps: string[] };  // 新增：继续迭代

type StopTrigger = 
  | 'budget' 
  | 'retry' 
  | 'stagnation' 
  | 'risk' 
  | 'verification_complete'      // 新增
  | 'max_iterations'            // 新增
  | 'max_tokens';               // 新增
```

---

## 三、Compaction 结构化摘要

### 3.1 问题分析

**v0.1 的问题**：
- 长对话上下文持续膨胀
- 没有压缩机制
- 早期重要信息可能被稀释

**pi-mono 的启发**：
- 结构化摘要格式（Goal / Progress / Decisions）
- 文件操作追踪
- Split Turn 处理

### 3.2 数据结构

```typescript
/**
 * 压缩条目
 */
interface CompactionEntry {
  type: 'compaction';
  id: string;
  timestamp: number;
  
  /** 结构化摘要 */
  summary: CompactionSummary;
  
  /** 第一个保留的消息 ID */
  firstKeptEntryId: string;
  
  /** 压缩前的 token 数 */
  tokensBefore: number;
  
  /** 压缩后的 token 数（估算） */
  tokensAfter?: number;
  
  /** 详细信息 */
  details: CompactionDetails;
}

interface CompactionSummary {
  /** 任务目标 */
  goal: string;
  
  /** 约束和偏好 */
  constraints: string[];
  
  /** 进度 */
  progress: {
    done: string[];
    inProgress: string[];
    blocked: string[];
  };
  
  /** 关键决策 */
  decisions: Array<{
    decision: string;
    rationale: string;
  }>;
  
  /** 下一步 */
  nextSteps: string[];
  
  /** 关键上下文（必须保留的信息） */
  criticalContext: string[];
}

interface CompactionDetails {
  /** 读取的文件 */
  readFiles: string[];
  
  /** 修改的文件 */
  modifiedFiles: string[];
  
  /** 从失败中学到的规则（Guardrails） */
  lessonsLearned: string[];
  
  /** 是否是 Split Turn */
  isSplitTurn: boolean;
}
```

### 3.3 压缩策略

```typescript
interface CompactionConfig {
  /** 是否启用自动压缩（默认 true） */
  enabled: boolean;
  
  /** 触发阈值：保留的 token 数（默认 20000） */
  reserveTokens: number;
  
  /** 保留最近 N tokens 不压缩（默认 5000） */
  keepRecentTokens: number;
  
  /** 压缩模型（默认使用主模型，可选专用轻量模型） */
  summarizerModel?: LLMAdapter;
  
  /** 自定义摘要提示词 */
  customPrompt?: string;
}

interface CompactionManager {
  /**
   * 检查是否需要压缩
   */
  shouldCompact(context: RuntimeContext): boolean;

  /**
   * 执行压缩
   */
  compact(messages: Message[]): Promise<CompactionEntry>;

  /**
   * 从压缩状态恢复上下文
   */
  restore(entry: CompactionEntry): Promise<RestoredContext>;
}
```

### 3.4 摘要生成 Prompt

```markdown
You are summarizing a conversation between a user and an AI agent.

Generate a structured summary with the following sections:

## Goal
[What the user is trying to accomplish - be specific]

## Constraints & Preferences
- [Requirements mentioned by user]
- [Preferences and style guidelines]
- [Technical constraints]

## Progress
### Done
- [x] [Completed tasks]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues, if any]

## Key Decisions
- **[Decision]**: [Rationale]

## Next Steps
1. [What should happen next]

## Critical Context
- [Data that must be preserved for the task to continue]

<read-files>
[List of files that were read]
</read-files>

<modified-files>
[List of files that were modified]
</modified-files>

<lessons-learned>
[Rules or patterns to avoid in future iterations]
</lessons-learned>
```

---

## 四、Guardrails 学习系统

### 4.1 问题分析

**痛点**：
- Agent 重复犯同样的错误
- 没有机制从失败中学习
- 错误经验无法跨会话共享

**Ralph Loop 的启发**：
- 失败时记录 "Signs" 到 guardrails.md
- 后续迭代读取这些规则
- 跨上下文轮换的 Agent 记忆

### 4.2 数据结构

```typescript
/**
 * Guardrails 规则
 */
interface GuardrailRule {
  /** 规则 ID */
  id: string;
  
  /** 规则描述 */
  rule: string;
  
  /** 触发条件 */
  trigger: {
    /** 错误类型 */
    errorType?: string;
    /** 错误模式（正则） */
    errorPattern?: string;
    /** 工具名称 */
    toolName?: string;
    /** 失败次数阈值 */
    failureThreshold?: number;
  };
  
  /** 生效时间 */
  createdAt: number;
  
  /** 最后触发时间 */
  lastTriggeredAt?: number;
  
  /** 触发次数 */
  triggerCount: number;
  
  /** 来源（自动学习 or 手动添加） */
  source: 'learned' | 'manual';
}

/**
 * Guardrails 存储
 */
interface GuardrailsStore {
  /**
   * 添加规则
   */
  addRule(rule: Omit<GuardrailRule, 'id' | 'createdAt' | 'triggerCount'>): Promise<string>;

  /**
   * 获取所有规则
   */
  getRules(): Promise<GuardrailRule[]>;

  /**
   * 检查是否应该触发规则
   */
  checkTrigger(context: ToolExecutionContext): Promise<GuardrailRule | null>;

  /**
   * 记录触发
   */
  recordTrigger(ruleId: string): Promise<void>;

  /**
   * 生成规则提示词（注入到 system prompt）
   */
  generatePrompt(): Promise<string>;
}
```

### 4.3 文件存储格式

```
.pace/
├── guardrails/
│   ├── rules.json          # 规则列表
│   └── learned.md          # 学习记录（可读格式）
```

**rules.json 示例**：
```json
{
  "rules": [
    {
      "id": "gr_001",
      "rule": "Do not use `rm -rf` without user confirmation",
      "trigger": {
        "toolName": "bash",
        "errorPattern": "rm -rf"
      },
      "createdAt": 1709000000000,
      "triggerCount": 3,
      "source": "learned"
    },
    {
      "id": "gr_002",
      "rule": "Always check file existence before reading",
      "trigger": {
        "errorType": "ENOENT",
        "failureThreshold": 2
      },
      "createdAt": 1709000100000,
      "triggerCount": 1,
      "source": "learned"
    }
  ]
}
```

### 4.4 与运行时集成

```typescript
// 在 PaceRuntime 中
class PaceRuntime {
  private guardrails: GuardrailsStore;

  async executeTool(tool: Tool, params: any): Promise<Result> {
    // 1. 检查 Guardrails
    const triggeredRule = await this.guardrails.checkTrigger({
      tool,
      params,
      context: this.context,
    });

    if (triggeredRule) {
      await this.guardrails.recordTrigger(triggeredRule.id);
      // 阻止执行或注入警告
      this.tracer.emit({
        type: 'GUARDRAIL_TRIGGERED',
        rule: triggeredRule,
        tool: tool.name,
      });
      
      // 返回错误或警告
      return {
        error: true,
        message: `Guardrail triggered: ${triggeredRule.rule}`,
      };
    }

    // 2. 执行工具
    try {
      return await tool.execute(params);
    } catch (error) {
      // 3. 失败时学习规则
      await this.learnFromFailure(tool, params, error);
      throw error;
    }
  }

  private async learnFromFailure(tool: Tool, params: any, error: Error): Promise<void> {
    // 分析失败模式，生成规则
    const rule = await this.analyzeFailurePattern(tool, params, error);
    if (rule) {
      await this.guardrails.addRule({
        rule: rule.description,
        trigger: rule.trigger,
        source: 'learned',
      });
    }
  }
}
```

---

## 五、基础沙箱隔离

### 5.1 设计决策

根据与 jaguar 的讨论，v0.2 采用**文件级沙箱**：

| 选项 | 描述 | v0.2 决策 |
|------|------|-----------|
| 文件级 | cp → 修改 → diff → 合并 | ✅ 采用 |
| 进程级 | bubblewrap/seatbelt | v0.3 |
| 容器级 | Docker/Kata | v0.4 |

### 5.2 API 设计

```typescript
/**
 * 沙箱配置
 */
interface SandboxConfig {
  /** 沙箱类型 */
  type: 'file-level';

  /** 源文件根目录 */
  sourceRoot: string;

  /** 工作区根目录（默认 .pace/workspace/） */
  workspaceRoot?: string;

  /** 禁止访问的路径模式 */
  deniedPaths?: string[];

  /** 网络隔离模式 */
  networkMode: 'none' | 'allow-list';

  /** 允许的域名列表（networkMode = 'allow-list' 时生效） */
  allowedDomains?: string[];
}

/**
 * 沙箱管理器
 */
interface SandboxManager {
  /**
   * 初始化沙箱
   */
  initialize(config: SandboxConfig): Promise<void>;

  /**
   * 同步文件到工作区（源 → 工作区）
   */
  syncToWorkspace(sourcePath: string): Promise<string>;

  /**
   * 获取工作区路径
   */
  getWorkspacePath(sourcePath: string): string;

  /**
   * 获取所有变更
   */
  getChanges(): Promise<FileChange[]>;

  /**
   * 合并回源（需要用户确认）
   */
  mergeToSource(changes: FileChange[], options?: MergeOptions): Promise<MergeResult>;

  /**
   * 丢弃工作区变更
   */
  discard(): Promise<void>;

  /**
   * 清理沙箱
   */
  cleanup(): Promise<void>;
}

/**
 * 文件变更
 */
interface FileChange {
  /** 相对路径 */
  path: string;

  /** 变更类型 */
  type: 'created' | 'modified' | 'deleted';

  /** unified diff */
  diff?: string;

  /** 风险等级 */
  risk: 'low' | 'medium' | 'high' | 'critical';

  /** 冲突信息（如果源文件也变了） */
  conflicts?: Conflict[];
}

/**
 * 合并选项
 */
interface MergeOptions {
  /** 是否自动批准低风险变更 */
  autoApproveLowRisk?: boolean;

  /** 自定义审批函数 */
  approvalHandler?: (changes: FileChange[]) => Promise<boolean>;
}

/**
 * 合并结果
 */
interface MergeResult {
  /** 是否成功 */
  success: boolean;

  /** 已合并的文件 */
  mergedFiles: string[];

  /** 跳过的文件（冲突） */
  skippedFiles: string[];

  /** 错误信息 */
  errors?: string[];
}
```

### 5.3 工作流程

```
1. 任务开始
   └── SandboxManager.initialize(config)

2. Agent 需要修改文件
   ├── 拦截 write/edit 工具调用
   ├── SandboxManager.syncToWorkspace(path)
   └── 重定向到工作区副本

3. Agent 在工作区操作
   └── 所有修改都在工作区进行

4. 任务完成
   ├── SandboxManager.getChanges()
   ├── 生成 diff 报告
   ├── 用户审批
   │   ├── Approve → mergeToSource()
   │   └── Reject → discard()
   └── 清理工作区
```

### 5.4 网络隔离

```typescript
/**
 * 网络策略（v0.2 简化版）
 */
interface NetworkPolicy {
  /** 模式 */
  mode: 'none' | 'allow-list';

  /** 允许的域名 */
  allowedDomains: string[];
}

// 默认允许列表
const DEFAULT_ALLOWED_DOMAINS = [
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
];
```

**实现方式**（v0.2 简化版）：
- 在 `http` / `fetch` 工具中检查 URL 域名
- 不在允许列表中的请求被拒绝
- 后续版本可升级为 proxy 模式

---

## 六、Extension 系统（基础）

### 6.1 API 设计

```typescript
/**
 * Extension API
 */
interface ExtensionAPI {
  /**
   * 订阅事件
   */
  on<E extends ExtensionEvent>(
    event: E['type'],
    handler: (event: E, ctx: ExtensionContext) => Promise<void | ExtensionResult>
  ): void;

  /**
   * 注册自定义工具
   */
  registerTool(tool: ToolDefinition): void;

  /**
   * 发送消息到 Agent
   */
  sendMessage(message: string, options?: SendMessageOptions): void;
}

/**
 * Extension 上下文
 */
interface ExtensionContext {
  /** 工作目录 */
  cwd: string;

  /** UI 交互（CLI） */
  ui: {
    notify(message: string, level: 'info' | 'warning' | 'error'): void;
    confirm(title: string, message: string): Promise<boolean>;
    select(title: string, options: string[]): Promise<string | undefined>;
  };

  /** 访问运行时状态 */
  runtime: {
    getTokenUsage(): TokenUsage;
    getCurrentModel(): string;
  };
}

/**
 * 事件类型（v0.2 基础集）
 */
type ExtensionEvent =
  | { type: 'session_start'; config: PaceConfig }
  | { type: 'task_start'; query: string }
  | { type: 'tool_call'; toolName: string; params: any; toolCallId: string }
  | { type: 'tool_result'; toolName: string; result: any; toolCallId: string }
  | { type: 'task_end'; status: 'success' | 'stopped' | 'error'; reason?: string }
  | { type: 'sandbox_merge'; changes: FileChange[] }
  | { type: 'session_shutdown' };

/**
 * Extension 返回结果
 */
type ExtensionResult =
  | void
  | { block: true; reason: string }  // 阻止操作
  | { modify: { params?: any; result?: any } };  // 修改参数或结果
```

### 6.2 使用示例

```typescript
// my-extension.ts
import { ExtensionAPI } from '@pace/core';

export default function (pi: ExtensionAPI) {
  // 阻止危险命令
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName === 'bash') {
      const cmd = event.params.command;
      if (cmd?.includes('rm -rf')) {
        const ok = await ctx.ui.confirm(
          'Dangerous Command',
          `Allow "rm -rf"?`
        );
        if (!ok) {
          return { block: true, reason: 'User denied dangerous command' };
        }
      }
    }
  });

  // 记录沙箱合并
  pi.on('sandbox_merge', async (event, ctx) => {
    ctx.ui.notify(
      `Merging ${event.changes.length} file(s)`,
      'info'
    );
  });
}
```

### 6.3 Extension 加载

```typescript
interface PaceConfig {
  // ... 现有配置 ...

  /**
   * Extension 列表
   */
  extensions?: Array<{
    /** Extension 模块路径 */
    path: string;
    /** 是否启用 */
    enabled?: boolean;
  }>;
}
```

---

## 七、实现计划

### Phase 1: 外部验证机制 (3-4 天)

**目标**：实现 `TaskCompletionVerifier` 和运行时集成

**任务**：
1. 定义 `TaskCompletionVerifier` 接口
2. 扩展 `TaskConfig` 和 `TerminationController`
3. 实现迭代循环逻辑
4. 更新 Tracer 事件
5. 编写单元测试
6. 编写文档和示例

**验收标准**：
- [ ] 验证器可以被正确调用
- [ ] 迭代循环按预期工作
- [ ] Trace 记录验证结果
- [ ] 单元测试覆盖率 ≥ 80%

### Phase 2: Compaction (2-3 天)

**目标**：实现结构化摘要和压缩机制

**任务**：
1. 定义 `CompactionEntry` 和 `CompactionManager` 接口
2. 实现摘要生成（使用 LLM）
3. 实现文件操作追踪
4. 集成到 RuntimeContext
5. 编写单元测试

**验收标准**：
- [ ] 长对话可以自动压缩
- [ ] 摘要格式正确
- [ ] 文件操作被正确追踪
- [ ] 单元测试覆盖率 ≥ 80%

### Phase 3: Guardrails (2 天)

**目标**：实现从失败中学习的机制

**任务**：
1. 定义 `GuardrailRule` 和 `GuardrailsStore` 接口
2. 实现文件存储
3. 实现失败模式分析
4. 集成到工具执行流程
5. 编写单元测试

**验收标准**：
- [ ] 规则可以被学习和持久化
- [ ] 规则可以阻止重复错误
- [ ] 规则提示词可以注入到 system prompt
- [ ] 单元测试覆盖率 ≥ 80%

### Phase 4: 基础沙箱 (3-4 天)

**目标**：实现文件级沙箱和基础网络隔离

**任务**：
1. 定义 `SandboxManager` 接口
2. 实现文件同步和变更追踪
3. 实现 diff 生成和合并
4. 实现网络隔离（域名检查）
5. 集成到 SecurityController
6. 编写单元测试

**验收标准**：
- [ ] 文件操作被重定向到工作区
- [ ] 变更可以正确合并或丢弃
- [ ] 网络请求被正确过滤
- [ ] 单元测试覆盖率 ≥ 80%

### Phase 5: Extension 系统 (2 天)

**目标**：实现基础事件订阅

**任务**：
1. 定义 `ExtensionAPI` 接口
2. 实现事件发射和订阅
3. 实现 tool_call/tool_result 拦截
4. 实现 Extension 加载
5. 编写单元测试

**验收标准**：
- [ ] Extension 可以订阅事件
- [ ] tool_call 可以被拦截
- [ ] Extension 可以被正确加载
- [ ] 单元测试覆盖率 ≥ 80%

### Phase 6: 集成测试和文档 (2 天)

**目标**：端到端测试和文档完善

**任务**：
1. 编写集成测试
2. 更新 README
3. 编写迁移指南（v0.1 → v0.2）
4. 更新 API 文档
5. 更新 CHANGELOG

---

## 八、风险和缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 外部验证增加复杂度 | 中 | 作为可选功能，默认关闭 |
| Compaction 摘要质量不稳定 | 中 | 提供自定义 prompt 选项 |
| Guardrails 误报 | 低 | 规则需要多次触发才生效 |
| 沙箱性能开销 | 低 | 只同步被修改的文件 |
| Extension 系统安全 | 中 | Extension 在沙箱外运行，需要用户信任 |

---

## 九、后续版本展望

### v0.3 计划

- OS 级沙箱（bubblewrap/seatbelt）
- Secret Injection
- Context Rotation
- Git Worktree 集成

### v0.4 计划

- 多 Agent 编排
- MCP 工具桥接
- 框架集成（LangChain 等）

---

## 附录

### A. 参考文档

- [Ralph Loop 学习笔记](../../memory/2025-02-24.md#ralph-loop)
- [pi-mono Compaction 设计](../../memory/2025-02-24.md#pi-mono-框架学习)
- [安全隔离设计](../../memory/2025-02-24.md#安全隔离设计)

### B. 相关 ADR

- ADR-001: 外部验证机制设计决策
- ADR-002: 沙箱隔离设计决策
- ADR-003: Compaction 策略设计决策

（待创建）
