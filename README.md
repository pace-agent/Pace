# Pace

> Progressive Agent Computing Engine — a disciplined runtime for AI agents.

Pace is a Node.js/TypeScript agent runtime framework that dramatically reduces context token consumption through progressive resource loading (L0/L1/L2), while providing built-in budget control, security policy enforcement, LLM-assisted relevance scoring, and full observability.

[中文文档](./README.zh.md)

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
│  │            Tracer (Observability)         │   │
│  └──────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │         LLM Adapter (pluggable)           │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Core Features

**Progressive Loading** — Resources follow a three-layer protocol. L0 indexes (~20–50 tokens each) are always injected; L1 previews load only for relevant resources; L2 full payloads load only at execution time. This cuts context token usage by 40–80% compared to full injection.

**Relevance Scoring** — The ContextCompiler supports two scoring paths:
- *Keyword mode* (default, no extra API call): keyword matching (weight 0.6) + sticky bonus (weight 0.4) for resources used in previous turns.
- *LLM-assisted mode* (Phase 3, optional): provide a `scoringLlm` adapter (e.g. a cheap Haiku model) to get precise 0.0–1.0 scores from the LLM. Sticky bonus is applied on top. Falls back to keyword scoring automatically on error. Emits a `RELEVANCE_SCORING` trace event with mode, latency, and fallback status.

**Budget Control** — BudgetScheduler tracks token usage across both the full task and each individual turn, ensuring the runtime stays within configurable limits.

**Security Policy** — SecurityController enforces S0 hard rules (shell exec, global delete, critical risk are unconditionally denied) plus three risk-tiered profiles: `open`, `balanced` (default), `strict`. Custom `SecurityPolicy` implementations are fully supported.

**Termination Control** — TerminationController detects four stop conditions: budget exhaustion, consecutive tool errors, stagnant output, and repeated security denials. All stop decisions are recorded as `STOP_TRIGGERED` trace events.

**Agentic Tool Loop** — When the LLM returns `tool_calls`, Pace automatically executes the tools (with security checks), injects results, and calls the LLM again — repeating until the model produces a final reply or a termination condition is triggered.

**Full Observability** — Every resource load, LLM call, tool invocation, policy decision, and relevance scoring step emits a structured JSONL trace event with token counts and latency, written to `.pace/traces/`.

## Quick Start

```bash
pnpm install
```

### Using OpenAI (original)

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

const result = await agent.run("Search the web for the latest TypeScript release");
console.log(result.reply);
console.log(result.tokenUsage);        // { inputTokens, outputTokens, contextTokens, totalTokens }
console.log(result.toolCallsExecuted); // number of tool calls executed
console.log(result.stopped);           // true if terminated by policy
console.log(result.trace);             // TraceEvent[] — resource loads, LLM calls, tool invocations
```

### Using Anthropic + Config File + SQLite Memory + LLM Scoring (Phase 3)

```typescript
import { loadPaceConfig } from "@pace-agent/config-loader";
import { Pace } from "@pace-agent/core";
import { AnthropicAdapter } from "@pace-agent/llm-anthropic";
import { SQLiteMemoryProvider } from "@pace-agent/memory-sqlite";

const { config } = await loadPaceConfig();   // reads pace.config.yaml

const memory = new SQLiteMemoryProvider({ dbPath: ".pace/memory.db" });

const agent = new Pace({
  llm: new AnthropicAdapter({ model: "claude-opus-4-6" }),
  resources: [myToolProvider, memory],
  config,
  // Cheap small model for scoring — does NOT count against task token budget
  scoringLlm: new AnthropicAdapter({ model: "claude-haiku-4-5-20251001" }),
});

const result = await agent.run("Find TypeScript 5.4 release notes");

// Inspect scoring events
result.trace
  .filter(e => e.type === "RELEVANCE_SCORING")
  .forEach(e => console.log(e));
// → { mode: "llm", candidateCount: 8, selectedCount: 2, latencyMs: 340 }
```

## Packages

| Package | Status | Description |
|---------|--------|-------------|
| `@pace-agent/core` | ✅ Phase 3 | Core runtime: ResourceRegistry, ContextCompiler (with LLM scoring), BudgetScheduler, JsonlTracer, PaceRuntime |
| `@pace-agent/llm-openai` | ✅ Phase 1 | OpenAI-compatible LLM adapter with tool_calls support |
| `@pace-agent/llm-anthropic` | ✅ Phase 3 | Anthropic Claude adapter with automatic consecutive-tool-message merging |
| `@pace-agent/config-loader` | ✅ Phase 3 | YAML/JSON config loader with env-var interpolation and auto-search |
| `@pace-agent/memory-sqlite` | ✅ Phase 3 | SQLite memory provider with FTS5 full-text index and TTL expiry |
| `@pace-agent/security` | ✅ Phase 2 | SecurityController with S0 rule engine and open/balanced/strict profiles |
| `@pace-agent/termination` | ✅ Phase 2 | TerminationController with budget/retry/stagnation/risk stop conditions |
| `@pace-agent/memory-file` | ✅ Phase 2 | File-system MemoryProvider with p0/p1/p2 priority tiers and TTL expiry |
| `@pace-agent/cli` | ✅ Phase 1 | CLI demo with token savings comparison |

## Phase 3 — New Packages

### @pace-agent/llm-anthropic

Implements `LLMAdapter` for Anthropic Claude. Key message-format conversions from Pace's OpenAI-style internal format to Anthropic API format:

| Pace internal | Anthropic API |
|---------------|---------------|
| `role:"system"` message | Separate `system` parameter |
| `role:"assistant"` + `toolCalls` | `content: [{type:"tool_use",...}]` |
| Consecutive `role:"tool"` messages | Merged into a single `user` message with multiple `tool_result` blocks |

`finishReason` mapping: `end_turn/stop_sequence → "stop"`, `tool_use → "tool_calls"`, `max_tokens → "length"`.

### @pace-agent/config-loader

Auto-search order: `pace.config.yaml` → `pace.config.yml` → `pace.config.json`

```yaml
# pace.config.yaml
budget:
  maxTokensPerTask: 30000
  maxTokensPerTurn: 5000
security: balanced
scoring:
  mode: auto                    # keyword | llm | auto
  llmThresholdCandidates: 10    # switch to LLM scoring when candidates >= 10
trace:
  output: .pace/traces/
# env-var interpolation (resolved before YAML parse):
# ${VAR}          → required, throws if missing
# ${VAR:-default} → fallback value
# ${VAR:?message} → throws with custom message
```

### @pace-agent/memory-sqlite

SQLite-backed drop-in replacement for `FileMemoryProvider`:

```typescript
const memory = new SQLiteMemoryProvider({
  dbPath: ".pace/memory.db",   // or ":memory:" for tests
  summaryMaxChars: 500,
  wal: true,
});
await memory.write(
  { name: "Project context", description: "", priority: "P0", tags: ["project"], ttlDays: 30 },
  "We are building a TypeScript agent runtime called Pace."
);
```

TTL filtering via SQL, FTS5 virtual table with insert/update/delete triggers (ready for Phase 4 full-text search).

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

## Development

### Prerequisites

- Node.js >= 22 (Node 20 works with a WARN)
- pnpm >= 9

### Setup

```bash
git clone <repo-url>
cd pace
pnpm install
```

### Commands

```bash
pnpm test         # Run all 104 tests
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
│   │   ├── types/          # All interface definitions
│   │   ├── registry/       # ResourceRegistry
│   │   ├── compiler/       # ContextCompiler (with LLM scoring), TokenEstimator
│   │   ├── budget/         # BudgetScheduler
│   │   ├── trace/          # JsonlTracer
│   │   └── runtime/        # PaceRuntime (exported as Pace)
│   ├── llm-openai/         # OpenAI adapter
│   ├── llm-anthropic/      # Anthropic adapter  (Phase 3)
│   ├── config-loader/      # pace.config.yaml loader  (Phase 3)
│   ├── memory-sqlite/      # SQLite memory provider  (Phase 3)
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

### v0.3 — Phase 3: Ecosystem ✅

- [x] Anthropic Claude adapter (`@pace-agent/llm-anthropic`)
- [x] LLM-assisted relevance scoring in ContextCompiler (`scoringLlm`, `scoringMode`, fallback)
- [x] Config file loading (`@pace-agent/config-loader`) with env-var interpolation
- [x] SQLite memory provider (`@pace-agent/memory-sqlite`) with FTS5 full-text index
- [x] `RELEVANCE_SCORING` trace event + `scoring` config section

### v0.4 — Phase 4: Multi-Agent & Observability (planned)

- [ ] Multi-agent orchestration (manager-worker)
- [ ] MCP tool bridge
- [ ] HTML observability dashboard
- [ ] SQLite FTS5 full-text search API

## License

MIT
