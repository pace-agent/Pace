# Pace

> Progressive Agent Computing Engine — a disciplined runtime for AI agents.

Pace is a Node.js/TypeScript agent runtime framework that dramatically reduces context token consumption through progressive resource loading (L0/L1/L2), while providing built-in safety controls, smart termination, and full observability.

## Core Features

**Progressive Loading** — All resources (tools, memory, skills, documents) follow a three-layer protocol. L0 indexes (~20 tokens each) are always available; L1 previews and L2 full payloads load only when needed. This cuts context token usage by 40%+.

**Safe Execution** — Every side-effectful operation is described by an ActionContract with risk levels. The SecurityController automatically blocks dangerous operations based on configurable policies (open / balanced / strict).

**Smart Termination** — Budget overruns, repeated errors, and stagnation trigger automatic shutdown with structured Failure Reports and actionable next-step suggestions instead of silent failures.

**Full Observability** — Every resource load, LLM call, tool invocation, and policy decision emits structured JSONL trace events with token accounting, enabling precise cost analysis and optimization.

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

## Quick Start

```bash
npm install @pace-agent/core @pace-agent/llm-openai @pace-agent/memory-file
```

```typescript
import { Pace } from "@pace-agent/core";
import { OpenAIAdapter } from "@pace-agent/llm-openai";
import { FileMemoryProvider } from "@pace-agent/memory-file";

const agent = new Pace({
  llm: new OpenAIAdapter({ model: "gpt-4o" }),

  resources: [
    new FileMemoryProvider({ dir: ".pace/memory" }),
    searchTool,
    calculatorTool,
  ],

  budget: {
    maxTokensPerTask: 20_000,
    maxTokensPerTurn: 4_000,
  },

  security: "balanced",

  termination: {
    maxRetries: 2,
    maxStagnation: 3,
  },
});

const result = await agent.run("Find the latest Node.js security advisories");
console.log(result.reply);
console.log(result.trace);       // TraceEvent[]
console.log(result.tokenUsage);  // { input, output, context, total }
```

## Packages

| Package | Description |
|---------|-------------|
| `@pace-agent/core` | Core runtime: types, ResourceRegistry, ContextCompiler, BudgetScheduler, Tracer |
| `@pace-agent/security` | SecurityController + built-in policies (S0 rule engine) |
| `@pace-agent/termination` | TerminationController + stop strategies (BudgetStop, RetryStop) |
| `@pace-agent/memory-file` | File-system MemoryProvider with L0/L1/L2 support |
| `@pace-agent/llm-openai` | OpenAI-compatible LLM adapter |
| `@pace-agent/cli` | CLI demo tool |

## Development

### Prerequisites

- Node.js >= 22
- pnpm >= 9

### Setup

```bash
git clone https://github.com/anthropics/pace.git
cd pace
pnpm install
```

### Commands

```bash
pnpm build        # Build all packages
pnpm test         # Run tests
pnpm lint         # Lint all packages
pnpm clean        # Remove dist directories
```

### Project Structure

```
pace/
├── packages/
│   ├── core/           # Core types & runtime
│   ├── security/       # Security controller
│   ├── termination/    # Termination controller
│   ├── memory-file/    # File-based memory provider
│   ├── llm-openai/     # OpenAI adapter
│   └── cli/            # CLI demo
├── docs/
│   └── PRD.md          # Product requirements
├── package.json        # Workspace root
├── tsconfig.base.json  # Shared TS config
└── vitest.config.ts    # Test config
```

## Roadmap

### v0.1 — Core Runtime (MVP)

- Resource three-layer protocol (L0/L1/L2)
- ContextCompiler with rule-based relevance
- BudgetScheduler + token tracking
- SecurityController (S0 rules)
- TerminationController (BudgetStop + RetryStop)
- OpenAI-compatible LLM adapter
- JSONL trace output
- File-based memory provider

### v0.2 — Expansion

- Multi-agent orchestration (manager-worker)
- HTTP + Shell tool providers
- StagnationStop detection
- S1 security checks (dry-run)
- Anthropic adapter
- Config file loading (pace.config.yaml)

### v0.3 — Ecosystem

- MCP tool bridge
- Redis / SQLite memory providers
- LangChain / Vercel AI SDK integration
- LLM-assisted relevance in ContextCompiler
- Basic HTML dashboard
- S2 security checks (LLM review)

## License

MIT
