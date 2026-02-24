import type {
  ResourceProvider,
  L0Index,
  L1Preview,
  L2Payload,
  ResourceType,
} from "@pace-agent/core";

// ---- Tool Provider ----

const TOOLS: L2Payload[] = [
  {
    id: "tool:web_search",
    name: "Web Search",
    description: "Search the web for current information",
    type: "tool",
    tags: ["search", "web", "query"],
    riskLevel: "low",
    summary:
      "Searches the internet using a search engine API. Returns top results with titles, snippets, and URLs.",
    parameterSummary: "query (string, required), maxResults (number, default 10)",
    example: '{ "query": "Node.js security advisory 2024", "maxResults": 5 }',
    constraints: "Rate limited to 100 requests/hour.",
    fullContent:
      "Full OpenAPI schema for web_search tool. Supports boolean operators, site: filter, and date range.",
  },
  {
    id: "tool:file_read",
    name: "File Reader",
    description: "Read contents of a file from the filesystem",
    type: "tool",
    tags: ["file", "read", "filesystem"],
    riskLevel: "low",
    summary: "Reads a file at the given path and returns its contents as a string.",
    parameterSummary: "path (string, required), encoding (string, default 'utf-8')",
    example: '{ "path": "/project/README.md" }',
    fullContent: "Full schema for file_read. Supports text and binary files.",
  },
  {
    id: "tool:file_write",
    name: "File Writer",
    description: "Write content to files on the filesystem",
    type: "tool",
    tags: ["file", "write", "filesystem"],
    riskLevel: "medium",
    summary: "Writes content to a file. Creates the file if it does not exist.",
    parameterSummary: "path (string, required), content (string, required), append (boolean, default false)",
    example: '{ "path": "/project/output.txt", "content": "Hello World" }',
    constraints: "Restricted to project directory. Cannot overwrite system files.",
    fullContent: "Full schema for file_write.",
  },
  {
    id: "tool:code_exec",
    name: "Code Executor",
    description: "Execute code snippets in a sandboxed environment",
    type: "tool",
    tags: ["code", "execute", "sandbox", "run"],
    riskLevel: "high",
    summary:
      "Runs code in an isolated sandbox and returns stdout, stderr, and exit code.",
    parameterSummary:
      "language (string, required), code (string, required), timeout (number, default 5000)",
    example: '{ "language": "python", "code": "print(\'hello\')" }',
    constraints: "Max execution time 30s. No network access from sandbox.",
    fullContent: "Full schema for code_exec.",
  },
  {
    id: "tool:db_query",
    name: "Database Query",
    description: "Execute read-only SQL queries against the project database",
    type: "tool",
    tags: ["database", "sql", "query", "read"],
    riskLevel: "medium",
    summary: "Runs a SELECT query on the configured database and returns rows as JSON.",
    parameterSummary: "sql (string, required), params (array, optional)",
    example: '{ "sql": "SELECT * FROM users WHERE id = $1", "params": [42] }',
    constraints: "Read-only. Max 1000 rows returned.",
    fullContent: "Full schema for db_query.",
  },
];

// ---- Memory Provider ----

const MEMORIES: L2Payload[] = [
  {
    id: "memory:user_prefs",
    name: "User Preferences",
    description: "Stored user preferences and settings",
    type: "memory",
    tags: ["preferences", "config", "settings"],
    riskLevel: "low",
    summary:
      "User-defined preferences: preferred language (TypeScript), verbosity (concise), theme (dark).",
    fullContent: JSON.stringify({
      language: "TypeScript",
      verbosity: "concise",
      theme: "dark",
      timezone: "UTC+8",
    }),
  },
  {
    id: "memory:project_ctx",
    name: "Project Context",
    description: "Current project metadata and active goals",
    type: "memory",
    tags: ["project", "context", "goals"],
    riskLevel: "low",
    summary:
      "Active project: Pace agent framework. Current phase: Phase 1 implementation. Stack: TypeScript, pnpm monorepo.",
    fullContent: JSON.stringify({
      project: "pace-agent",
      phase: "Phase 1",
      stack: ["TypeScript", "pnpm", "vitest"],
    }),
  },
  {
    id: "memory:debug_log",
    name: "Debug Log",
    description: "Recent debug notes and error patterns from previous sessions",
    type: "memory",
    tags: ["debug", "errors", "log"],
    riskLevel: "low",
    summary:
      "Recent issues: ESM import path requires .js extension, zod v3 peer dependency conflict resolved.",
    fullContent:
      "Session 2024-01-15: Fixed ESM .js import paths. Session 2024-01-16: zod peer dep resolved by hoisting.",
  },
];

function toL0(payload: L2Payload): L0Index {
  const { summary: _s, parameterSummary: _p, example: _e, constraints: _c, fullContent: _f, ...l0 } = payload as L2Payload & { summary?: string; parameterSummary?: string; example?: string; constraints?: string };
  return l0;
}

function toL1(payload: L2Payload): L1Preview {
  const { fullContent: _f, ...l1 } = payload;
  return l1;
}

export class MockToolProvider implements ResourceProvider {
  readonly type: ResourceType = "tool";

  async listL0(): Promise<L0Index[]> {
    return TOOLS.map(toL0);
  }

  async getL1(id: string): Promise<L1Preview> {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) throw new Error(`Tool not found: ${id}`);
    return toL1(tool);
  }

  async getL2(id: string): Promise<L2Payload> {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) throw new Error(`Tool not found: ${id}`);
    return tool;
  }
}

export class MockMemoryProvider implements ResourceProvider {
  readonly type: ResourceType = "memory";

  async listL0(): Promise<L0Index[]> {
    return MEMORIES.map(toL0);
  }

  async getL1(id: string): Promise<L1Preview> {
    const mem = MEMORIES.find((m) => m.id === id);
    if (!mem) throw new Error(`Memory not found: ${id}`);
    return toL1(mem);
  }

  async getL2(id: string): Promise<L2Payload> {
    const mem = MEMORIES.find((m) => m.id === id);
    if (!mem) throw new Error(`Memory not found: ${id}`);
    return mem;
  }
}
