# Pace

> Progressive Agent Computing Engine — a disciplined runtime for AI agents.

Pace is a Node.js/TypeScript agent runtime framework that dramatically reduces context token consumption through progressive resource loading (L0/L1/L2), while providing built-in budget control, security policy enforcement, and full observability.

[中文文档](./README.zh.md)

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
│  │            Tracer (Observability)         │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │         LLM Adapter (pluggable)           │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Core Features

**Progressive Loading** — Resources follow a three-layer protocol. L0 indexes (~20–50 tokens each) are always injected; L1 previews load only for relevant resources; L2 full payloads load only at execution time. This cuts context token usage by 40–80% compared to full injection.

**Relevance Scoring** — The ContextCompiler scores each resource against the user query using keyword matching (weight 0.6) plus a sticky bonus (weight 0.4) for resources used in previous turns. Only resources above threshold are promoted to L1.

**Budget Control** — BudgetScheduler tracks token usage across both the full task and each individual turn, ensuring the runtime stays within configurable limits.

**Security Policy** — SecurityController enforces S0 hard rules (shell exec, global delete, critical risk are unconditionally denied) plus three risk-tiered profiles: `open`, `balanced` (default), `strict`. Custom `SecurityPolicy` implementations are fully supported.

**Termination Control** — TerminationController detects four stop conditions: budget exhaustion, consecutive tool errors, stagnant output, and repeated security denials. All stop decisions are recorded as `STOP_TRIGGERED` trace events.

**Agentic Tool Loop** — When the LLM returns `tool_calls`, Pace automatically executes the tools (with security checks), injects results, and calls the LLM again — repeating until the model produces a final reply or a termination condition is triggered.

**Full Observability** — Every resource load, LLM call, tool invocation, and policy decision emits a structured JSONL trace event with token counts and latency, written to `.pace/traces/`.

## Quick Start

```bash
pnpm install
```

```typescript
import { Pace } from "@pace-agent/core";
import { OpenAIAdapter } from "@pace-agent/llm-openai";
import { SecurityController } from "@pace-agent/security";
import { TerminationController } from "@pace-agent/termination";

const agent = new Pace({
  llm: new OpenAIAdapter({ model: "gpt-4o" }),
  resources: [myToolProvider, myMemoryProvider],
  config: {
    budget: { maxTokensPerTask: 20_000, maxTokensPerTurn: 4_000 },
    security: "balanced",          // "open" | "balanced" | "strict"
    termination: { maxRetries: 3, maxStagnation: 3, maxSecurityDenials: 2 },
  },
});

const result = await agent.run("Search the web for the latest TypeScript release");
console.log(result.reply);
console.log(result.tokenUsage);        // { inputTokens, outputTokens, contextTokens, totalTokens }
console.log(result.toolCallsExecuted); // number of tool calls executed
console.log(result.stopped);           // true if terminated by policy
console.log(result.trace);             // TraceEvent[] — resource loads, LLM calls, tool invocations
```

## Packages

| Package | Status | Description |
|---------|--------|-------------|
| `@pace-agent/core` | ✅ Phase 2 | Core runtime: ResourceRegistry, ContextCompiler, BudgetScheduler, JsonlTracer, PaceRuntime (with agentic loop) |
| `@pace-agent/llm-openai` | ✅ Phase 2 | OpenAI-compatible LLM adapter with tool_calls support |
| `@pace-agent/security` | ✅ Phase 2 | SecurityController with S0 rule engine and open/balanced/strict profiles |
| `@pace-agent/termination` | ✅ Phase 2 | TerminationController with budget/retry/stagnation/risk stop conditions |
| `@pace-agent/memory-file` | ✅ Phase 2 | File-system MemoryProvider with p0/p1/p2 priority tiers and TTL expiry |
| `@pace-agent/cli` | ✅ Phase 1 | CLI demo with token savings comparison |

## Implementing a ToolProvider

```typescript
import type { ResourceProvider, ToolProvider, ToolDefinition, ToolResult } from "@pace-agent/core";

class MyToolProvider implements ResourceProvider, ToolProvider {
  readonly type = "tool" as const;

  async listL0() {
    return [{ id: "tool:web_search", name: "Web Search", description: "Search the web",
              type: "tool", tags: ["search"], riskLevel: "low" }];
  }

  async getL1(id: string) {
    return { id, name: "Web Search", type: "tool", tags: ["search"],
             description: "Search the web", summary: "Returns titles and URLs.",
             parameterSummary: "query (string, required)" };
  }

  async getL2(id: string) {
    return { ...await this.getL1(id), fullContent: "<full JSON schema>" };
  }

  async listTools(): Promise<ToolDefinition[]> {
    return [{ name: "web_search", description: "Search the web", tags: ["search"],
              risk: "low", preview: "Search the internet", parameters: { type: "object" },
              execute: async (p) => search(p) }];
  }

  async getTool(name: string): Promise<ToolDefinition | undefined> {
    return (await this.listTools()).find(t => t.name === name);
  }

  async executeTool(name: string, params: unknown): Promise<ToolResult> {
    const tool = await this.getTool(name);
    if (!tool) return { success: false, error: "Unknown tool", latencyMs: 0 };
    const start = Date.now();
    const output = await tool.execute(params);
    return { success: true, output, latencyMs: Date.now() - start };
  }
}
```

## Using SecurityController

```typescript
import { SecurityController } from "@pace-agent/security";

const agent = new Pace({
  llm,
  resources: [myToolProvider],
  securityPolicy: new SecurityController({ profile: "balanced" }),
});
```

S0 hard rules (applied regardless of profile):
- Shell command execution → always denied
- Global-scope delete → always denied
- Critical risk level → always denied
- Irreversible batch operations → escalated to human approval

## Using FileMemoryProvider

```typescript
import { FileMemoryProvider } from "@pace-agent/memory-file";

const memory = new FileMemoryProvider(".pace/memory");
await memory.init();

const agent = new Pace({ llm, resources: [memory] });

// Write a memory entry
await memory.write(
  { name: "Project Context", description: "Current project", priority: "P0", tags: ["project"] },
  "We are building a TypeScript agent runtime called Pace."
);
```

## Development

### Prerequisites

- Node.js >= 22
- pnpm >= 9

### Setup

```bash
git clone <repo-url>
cd pace
pnpm install
```

### Commands

```bash
pnpm test         # Run all 71 tests
pnpm build        # Build all packages
pnpm lint         # Lint
pnpm clean        # Remove dist directories
```

### Run the Demo

```bash
# No API key required — uses MockLLMAdapter
pnpm demo

# With real LLM
OPENAI_API_KEY=sk-... pnpm demo
```

### Project Structure

```
pace/
├── packages/
│   ├── core/src/
│   │   ├── types/          # All interface definitions (resource, llm, trace, security, termination, memory, tool, action)
│   │   ├── registry/       # ResourceRegistry
│   │   ├── compiler/       # ContextCompiler, TokenEstimator
│   │   ├── budget/         # BudgetScheduler
│   │   ├── trace/          # JsonlTracer
│   │   └── runtime/        # PaceRuntime with agentic loop (exported as Pace)
│   ├── llm-openai/         # OpenAI adapter
│   ├── security/           # SecurityController
│   ├── termination/        # TerminationController
│   ├── memory-file/        # FileMemoryProvider
│   └── cli/                # Demo entry + mock resources
├── package.json
├── tsconfig.base.json
└── vitest.config.ts
```

## Roadmap

### v0.1 — Phase 1: Core Runtime ✅

- [x] L0/L1/L2 three-layer resource protocol
- [x] ResourceRegistry with multi-provider aggregation and L0 cache
- [x] ContextCompiler: keyword relevance scoring + sticky L1 + budget pruning
- [x] BudgetScheduler: per-task and per-turn token accounting
- [x] JsonlTracer: buffered JSONL event output
- [x] PaceRuntime: multi-turn conversation with history accumulation
- [x] OpenAI-compatible LLM adapter
- [x] CLI demo with token savings comparison

### v0.2 — Phase 2: Safety & Termination ✅

- [x] SecurityController: S0 rule engine with open/balanced/strict profiles
- [x] TerminationController: budget/retry/stagnation/risk stop conditions with `buildFailureReport()`
- [x] Agentic tool execution loop: security check → execute → inject result → re-prompt
- [x] FileMemoryProvider: file-system memory with p0/p1/p2 priority tiers and TTL expiry
- [x] `Message` type extended with `toolCalls` field; OpenAIAdapter handles assistant tool_calls
- [x] `RunResult` extended with `stopped`, `stopReason`, `toolCallsExecuted`

### v0.3 — Phase 3: Ecosystem

- [ ] Multi-agent orchestration (manager-worker)
- [ ] MCP tool bridge
- [ ] LLM-assisted relevance in ContextCompiler
- [ ] Anthropic adapter
- [ ] Redis / SQLite memory providers
- [ ] Config file loading (`pace.config.yaml`)
- [ ] Basic HTML observability dashboard

## License

MIT
