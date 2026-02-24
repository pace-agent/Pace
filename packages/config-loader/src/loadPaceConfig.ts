import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { parsePaceConfig, type PaceConfig } from "@pace-agent/core";

// ── Error types ───────────────────────────────────────────────────────────────

export class ConfigEnvError extends Error {
  constructor(
    public readonly varName: string,
    message?: string,
  ) {
    super(message ?? `Environment variable "${varName}" is not defined`);
    this.name = "ConfigEnvError";
  }
}

export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LoadPaceConfigOptions {
  /** Explicit path to config file. If provided and missing, behaviour depends on `required`. */
  configPath?: string;
  /** Working directory for auto-search. Defaults to process.cwd(). */
  cwd?: string;
  /**
   * When `true` and an explicit `configPath` is given but not found, throws an error.
   * Has no effect for auto-search (missing config = use defaults).
   * Default: false
   */
  required?: boolean;
}

export interface LoadResult {
  config: PaceConfig;
  /** Resolved path of the loaded file, or null when defaults were used. */
  configPath: string | null;
  /** True when no config file was found and all values come from schema defaults. */
  usedDefaults: boolean;
}

/** Auto-search order */
const AUTO_SEARCH_NAMES = ["pace.config.yaml", "pace.config.yml", "pace.config.json"];

/**
 * Async version of config loading.
 */
export async function loadPaceConfig(options?: LoadPaceConfigOptions): Promise<LoadResult> {
  return loadPaceConfigImpl(options, false) as Promise<LoadResult>;
}

/**
 * Synchronous version of config loading.
 */
export function loadPaceConfigSync(options?: LoadPaceConfigOptions): LoadResult {
  return loadPaceConfigImpl(options, true) as LoadResult;
}

// ── Implementation ────────────────────────────────────────────────────────────

function loadPaceConfigImpl(
  options: LoadPaceConfigOptions | undefined,
  sync: boolean,
): LoadResult | Promise<LoadResult> {
  const cwd = options?.cwd ?? process.cwd();
  const required = options?.required ?? false;

  // Determine the file to load
  let resolvedPath: string | null = null;

  if (options?.configPath) {
    const abs = path.resolve(cwd, options.configPath);
    if (fs.existsSync(abs)) {
      resolvedPath = abs;
    } else if (required) {
      throw new ConfigEnvError(
        options.configPath,
        `Config file not found: ${abs}`,
      );
    }
  } else {
    // Auto-search
    for (const name of AUTO_SEARCH_NAMES) {
      const candidate = path.join(cwd, name);
      if (fs.existsSync(candidate)) {
        resolvedPath = candidate;
        break;
      }
    }
  }

  if (resolvedPath === null) {
    // Use schema defaults
    const config = parsePaceConfig({});
    const result: LoadResult = { config, configPath: null, usedDefaults: true };
    return sync ? result : Promise.resolve(result);
  }

  if (sync) {
    const raw = fs.readFileSync(resolvedPath, "utf-8");
    return parseConfigFile(resolvedPath, raw);
  } else {
    return fs.promises.readFile(resolvedPath, "utf-8").then((raw) =>
      parseConfigFile(resolvedPath!, raw),
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Substitute environment variables in a raw config string before YAML/JSON parsing.
 * Supported patterns (bash-style):
 *   ${VAR}           → process.env.VAR  (throws ConfigEnvError if undefined)
 *   ${VAR:-fallback} → process.env.VAR ?? "fallback"
 *   ${VAR:?message}  → process.env.VAR ?? throws ConfigEnvError(message)
 */
function substituteEnvVars(raw: string): string {
  return raw.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    // ${VAR:?message}
    const errorMatch = /^([A-Za-z_][A-Za-z0-9_]*):(?:\?)(.*)?$/.exec(expr);
    if (errorMatch) {
      const varName = errorMatch[1] as string;
      const message = errorMatch[2] as string;
      const val = process.env[varName];
      if (val === undefined) {
        throw new ConfigEnvError(varName, message || `"${varName}" is required`);
      }
      return val;
    }

    // ${VAR:-fallback}
    const defaultMatch = /^([A-Za-z_][A-Za-z0-9_]*):-(.*)$/.exec(expr);
    if (defaultMatch) {
      const varName = defaultMatch[1] as string;
      const fallback = defaultMatch[2] as string;
      return process.env[varName] ?? fallback;
    }

    // ${VAR}
    const val = process.env[expr];
    if (val === undefined) throw new ConfigEnvError(expr);
    return val;
  });
}

function parseConfigFile(filePath: string, raw: string): LoadResult {
  // Step 1: env var substitution (must happen before YAML/JSON parsing)
  const substituted = substituteEnvVars(raw);

  // Step 2: parse YAML or JSON
  let parsed: unknown;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    parsed = JSON.parse(substituted);
  } else {
    // .yaml or .yml
    parsed = yaml.load(substituted);
  }

  // Step 3: Zod validation via parsePaceConfig
  try {
    const config = parsePaceConfig(parsed);
    return { config, configPath: filePath, usedDefaults: false };
  } catch (err) {
    // Convert ZodError to a user-friendly ConfigValidationError
    const issues: string[] = [];
    if (err && typeof err === "object" && "issues" in err) {
      const zodErr = err as { issues: Array<{ path: (string | number)[]; message: string }> };
      for (const issue of zodErr.issues) {
        const fieldPath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
        issues.push(`  \u2022 ${fieldPath}: ${issue.message}`);
      }
    }
    throw new ConfigValidationError(
      `Invalid config at ${filePath}:\n${issues.join("\n")}`,
      issues,
    );
  }
}
