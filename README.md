# Pace

> Progressive Agent Computing Engine — a disciplined runtime for AI agents.

Pace is a Node.js/TypeScript agent runtime framework that dramatically reduces context token consumption through progressive resource loading (L0/L1/L2), while providing built-in budget control and full observability.

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

**Full Observability** — Every resource load and LLM call emits a structured JSONL trace event with token counts and latency, written to `.pace/traces/`.

## Quick Start

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

const result = await agent.run("Search the web for the latest TypeScript release");
console.log(result.reply);
console.log(result.tokenUsage);  // { inputTokens, outputTokens, contextTokens, totalTokens }
console.log(result.trace);       // TraceEvent[] — resource loads, LLM calls
```

## Packages

| Package | Status | Description |
|---------|--------|-------------|
| `@pace-agent/core` | ✅ Phase 1 | Core runtime: ResourceRegistry, ContextCompiler, BudgetScheduler, JsonlTracer, PaceRuntime |
| `@pace-agent/llm-openai` | ✅ Phase 1 | OpenAI-compatible LLM adapter |
| `@pace-agent/cli` | ✅ Phase 1 | CLI demo with token savings comparison |
| `@pace-agent/security` | 🔜 Phase 2 | SecurityController + built-in policies |
| `@pace-agent/termination` | 🔜 Phase 2 | TerminationController (BudgetStop, RetryStop, StagnationStop) |
| `@pace-agent/memory-file` | 🔜 Phase 2 | File-system MemoryProvider with L0/L1/L2 support |

## Implementing a ResourceProvider

```typescript
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "@pace-agent/core";

class MyToolProvider implements ResourceProvider {
  readonly type = "tool" as const;

  async listL0(): Promise<L0Index[]> {
    return [{ id: "tool:my_tool", name: "My Tool", description: "...", type: "tool", tags: ["example"], riskLevel: "low" }];
  }

  async getL1(id: string): Promise<L1Preview> {
    return { id, name: "My Tool", description: "...", type: "tool", tags: ["example"],
      summary: "Does X by doing Y.", parameterSummary: "input (string, required)" };
  }

  async getL2(id: string): Promise<L2Payload> {
    return { ...await this.getL1(id), fullContent: "<full JSON schema>" };
  }
}

const agent = new Pace({
  llm: new OpenAIAdapter({ model: "gpt-4o" }),
  resources: [new MyToolProvider()],
});
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
pnpm test         # Run all 37 tests
pnpm build        # Build all packages
pnpm lint         # Lint
pnpm clean        # Remove dist directories
```

### Run the Demo

```bash
# No API key required — uses MockLLMAdapter
node packages/cli/src/index.ts

# With real LLM
OPENAI_API_KEY=sk-... node packages/cli/src/index.ts
```

### Project Structure

```
pace/
├── packages/
│   ├── core/src/
│   │   ├── types/          # Phase 0: all interface definitions
│   │   ├── registry/       # ResourceRegistry
│   │   ├── compiler/       # ContextCompiler, TokenEstimator, types
│   │   ├── budget/         # BudgetScheduler
│   │   ├── trace/          # JsonlTracer
│   │   └── runtime/        # PaceRuntime (exported as Pace)
│   ├── llm-openai/         # OpenAI adapter
│   └── cli/                # Demo entry + mock resources
├── docs/
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

### v0.2 — Phase 2: Safety & Termination 🔜

- [ ] SecurityController (S0 rule engine: risk level evaluation)
- [ ] TerminationController (BudgetStop, RetryStop, StagnationStop)
- [ ] Tool execution loop (handle `finishReason === "tool_calls"`)
- [ ] FileMemoryProvider
- [ ] Anthropic adapter

### v0.3 — Phase 3: Ecosystem

- [ ] Multi-agent orchestration (manager-worker)
- [ ] MCP tool bridge
- [ ] LLM-assisted relevance in ContextCompiler
- [ ] Redis / SQLite memory providers
- [ ] Config file loading (`pace.config.yaml`)
- [ ] Basic HTML observability dashboard

## License

MIT
