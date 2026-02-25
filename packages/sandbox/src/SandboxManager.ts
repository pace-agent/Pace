import { mkdir, cp, rm, readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join, relative, dirname, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  SandboxConfig,
  FileChange,
  FileChangeType,
  ChangeRisk,
  FileConflict,
  MergeOptions,
  MergeResult,
} from "./types/sandbox.js";
import type { TraceWriter, TraceEvent } from "@pace-agent/core";

/**
 * SandboxManagerOptions — Options for creating a SandboxManager.
 */
export interface SandboxManagerOptions {
  /** Sandbox configuration */
  config: SandboxConfig;

  /** Trace writer for events (optional) */
  traceWriter?: TraceWriter;
}

/**
 * SandboxManager — Manages file-level workspace isolation.
 *
 * This class implements the workspace isolation mechanism from v0.2 design.
 * It creates an isolated workspace where agents can safely modify files
 * without affecting the source. Changes can be reviewed and merged back
 * with user approval.
 *
 * Key features:
 * - File synchronization (source → workspace)
 * - Change tracking and diff generation
 * - Risk assessment for file changes
 * - Merge workflow with conflict detection
 *
 * @example
 * ```typescript
 * const sandbox = new SandboxManager({
 *   config: {
 *     workspaceRoot: '.pace/workspace',
 *     sourceRoot: process.cwd(),
 *     deniedPaths: ['.env', 'secrets/*'],
 *     networkMode: 'allow',
 *     allowedDomains: ['api.anthropic.com'],
 *   },
 * });
 *
 * await sandbox.initialize();
 * await sandbox.syncToWorkspace('src/auth.ts');
 *
 * // Agent modifies file in workspace...
 *
 * const changes = await sandbox.getChanges();
 * const result = await sandbox.mergeToSource(changes);
 * ```
 */
export class SandboxManager {
  private readonly config: SandboxConfig;
  private readonly traceWriter?: TraceWriter;

  /** Tracks files that have been synced to the workspace */
  private readonly syncedFiles: Map<string, string> = new Map();

  /** Tracks original file hashes at sync time */
  private readonly originalHashes: Map<string, string> = new Map();

  /** Tracks source file hashes for change detection */
  private readonly sourceHashes: Map<string, string> = new Map();

  /** Whether the sandbox has been initialized */
  private initialized: boolean = false;

  constructor(options: SandboxManagerOptions) {
    this.config = options.config;
    this.traceWriter = options.traceWriter;
    this.validateConfig();
  }

  /**
   * Validate sandbox configuration.
   */
  private validateConfig(): void {
    const { workspaceRoot, sourceRoot, deniedPaths } = this.config;

    if (!workspaceRoot || typeof workspaceRoot !== "string") {
      throw new Error("SandboxConfig.workspaceRoot must be a non-empty string");
    }

    if (!sourceRoot || typeof sourceRoot !== "string") {
      throw new Error("SandboxConfig.sourceRoot must be a non-empty string");
    }

    if (!Array.isArray(deniedPaths)) {
      throw new Error("SandboxConfig.deniedPaths must be an array");
    }

    if (this.config.limits) {
      const { maxFileSize, maxTotalSize, timeoutMs } = this.config.limits;

      if (maxFileSize !== undefined && maxFileSize < 1) {
        throw new Error("SandboxLimits.maxFileSize must be a positive number");
      }

      if (maxTotalSize !== undefined && maxTotalSize < 1) {
        throw new Error("SandboxLimits.maxTotalSize must be a positive number");
      }

      if (timeoutMs !== undefined && timeoutMs < 0) {
        throw new Error("SandboxLimits.timeoutMs must be a non-negative number");
      }
    }
  }

  /**
   * Initialize the sandbox workspace.
   * Creates the workspace directory if it doesn't exist.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create workspace directory
    await mkdir(this.config.workspaceRoot, { recursive: true });

    this.initialized = true;

    this.emitTraceEvent({
      type: "SANDBOX_INIT",
      timestamp: Date.now(),
      config: this.config,
    });
  }

  /**
   * Sync a file from source to workspace.
   *
   * @param sourcePath - Path relative to sourceRoot
   * @returns Absolute path in the workspace
   */
  async syncToWorkspace(sourcePath: string): Promise<string> {
    await this.ensureInitialized();

    // Normalize and validate path
    const normalizedPath = this.normalizePath(sourcePath);
    this.validatePathAccess(normalizedPath);

    const absoluteSourcePath = join(this.config.sourceRoot, normalizedPath);
    const workspacePath = join(this.config.workspaceRoot, normalizedPath);

    // Check file size limit
    await this.checkFileSize(absoluteSourcePath);

    // Ensure workspace directory exists
    await mkdir(dirname(workspacePath), { recursive: true });

    // Copy file to workspace
    await cp(absoluteSourcePath, workspacePath, { force: true });

    // Store original hash for change detection
    const hash = await this.computeFileHash(absoluteSourcePath);
    this.originalHashes.set(normalizedPath, hash);
    this.sourceHashes.set(normalizedPath, hash);
    this.syncedFiles.set(normalizedPath, workspacePath);

    this.emitTraceEvent({
      type: "SANDBOX_FILE_SYNC",
      timestamp: Date.now(),
      sourcePath: normalizedPath,
      workspacePath,
    });

    return workspacePath;
  }

  /**
   * Sync multiple files to workspace.
   *
   * @param paths - Array of paths relative to sourceRoot
   * @returns Array of absolute workspace paths
   */
  async syncBatch(paths: string[]): Promise<string[]> {
    const results: string[] = [];

    for (const path of paths) {
      results.push(await this.syncToWorkspace(path));
    }

    return results;
  }

  /**
   * Get all changes in the workspace.
   *
   * @returns Array of file changes
   */
  async getChanges(): Promise<FileChange[]> {
    await this.ensureInitialized();

    const changes: FileChange[] = [];

    for (const [relativePath, workspacePath] of this.syncedFiles) {
      const change = await this.getFileChange(relativePath);
      if (change) {
        changes.push(change);
      }
    }

    return changes;
  }

  /**
   * Get change for a specific file.
   *
   * @param sourcePath - Path relative to sourceRoot
   * @returns FileChange or null if no change
   */
  async getFileChange(sourcePath: string): Promise<FileChange | null> {
    await this.ensureInitialized();

    const normalizedPath = this.normalizePath(sourcePath);
    const workspacePath = this.syncedFiles.get(normalizedPath);

    if (!workspacePath) {
      return null;
    }

    const sourcePath2 = join(this.config.sourceRoot, normalizedPath);

    // Check if file exists in both locations
    const sourceExists = await this.fileExists(sourcePath2);
    const workspaceExists = await this.fileExists(workspacePath);

    if (!workspaceExists) {
      // File was deleted in workspace
      if (sourceExists) {
        return this.createFileChange(normalizedPath, "deleted");
      }
      return null;
    }

    if (!sourceExists) {
      // File was created in workspace
      return this.createFileChange(normalizedPath, "created");
    }

    // Compare hashes
    const originalHash = this.originalHashes.get(normalizedPath);
    const workspaceHash = await this.computeFileHash(workspacePath);

    if (originalHash !== workspaceHash) {
      return this.createFileChange(normalizedPath, "modified");
    }

    return null;
  }

  /**
   * Merge changes back to source.
   *
   * @param changes - Changes to merge
   * @param options - Merge options
   * @returns Merge result
   */
  async mergeToSource(
    changes: FileChange[],
    options: MergeOptions = {}
  ): Promise<MergeResult> {
    await this.ensureInitialized();

    const mergedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const conflicts: FileChange[] = [];

    for (const change of changes) {
      try {
        // Check for conflicts unless skipped
        if (!options.skipConflictCheck) {
          const hasConflict = await this.detectConflict(change);
          if (hasConflict) {
            if (change.conflict) {
              conflicts.push(change);
            }
            skippedFiles.push(change.path);
            continue;
          }
        }

        // Perform the merge
        await this.mergeFile(change);
        mergedFiles.push(change.path);
      } catch (error) {
        skippedFiles.push(change.path);
        this.emitTraceEvent({
          type: "SANDBOX_MERGE_ERROR",
          timestamp: Date.now(),
          path: change.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const result: MergeResult = {
      success: conflicts.length === 0,
      mergedFiles,
      skippedFiles,
      conflicts,
    };

    this.emitTraceEvent({
      type: "SANDBOX_MERGE_END",
      timestamp: Date.now(),
      result,
    });

    return result;
  }

  /**
   * Discard all changes in the workspace.
   */
  async discard(): Promise<void> {
    await this.ensureInitialized();

    const changes = await this.getChanges();

    for (const [relativePath, workspacePath] of this.syncedFiles) {
      try {
        await rm(workspacePath, { force: true });
      } catch {
        // Ignore errors when discarding
      }
    }

    this.syncedFiles.clear();
    this.originalHashes.clear();
    this.sourceHashes.clear();

    this.emitTraceEvent({
      type: "SANDBOX_DISCARD",
      timestamp: Date.now(),
      changes,
    });
  }

  /**
   * Destroy the sandbox workspace completely.
   */
  async destroy(): Promise<void> {
    await this.discard();

    try {
      await rm(this.config.workspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore errors when destroying
    }

    this.initialized = false;
  }

  /**
   * Check if a path is within the sandbox.
   */
  isSandboxed(path: string): boolean {
    const absolutePath = resolve(path);
    const workspaceRoot = resolve(this.config.workspaceRoot);
    return absolutePath.startsWith(workspaceRoot);
  }

  /**
   * Rewrite a source path to workspace path.
   */
  rewritePath(sourcePath: string): string {
    const normalizedPath = this.normalizePath(sourcePath);
    return join(this.config.workspaceRoot, normalizedPath);
  }

  // ---- Private Helper Methods ----

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private normalizePath(path: string): string {
    // Normalize path separators and remove leading ./
    let normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");

    // Remove leading slash
    if (normalized.startsWith("/")) {
      normalized = normalized.slice(1);
    }

    return normalized;
  }

  private validatePathAccess(path: string): void {
    const { deniedPaths } = this.config;

    for (const pattern of deniedPaths) {
      if (this.matchesPattern(path, pattern)) {
        throw new Error(`Access denied: path "${path}" matches denied pattern "${pattern}"`);
      }
    }
  }

  private matchesPattern(path: string, pattern: string): boolean {
    // Simple glob pattern matching
    // Supports: *, **, exact match
    const regex = this.patternToRegex(pattern);
    return regex.test(path);
  }

  private patternToRegex(pattern: string): RegExp {
    // Convert glob pattern to regex
    let regex = pattern
      .replace(/\*\*/g, "<<DOUBLE_STAR>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<DOUBLE_STAR>>/g, ".*")
      .replace(/\?/g, "[^/]")
      .replace(/\./g, "\\.");

    // Anchor the pattern
    if (!regex.startsWith("^")) {
      regex = "^" + regex;
    }
    if (!regex.endsWith("$")) {
      regex = regex + "$";
    }

    return new RegExp(regex);
  }

  private async checkFileSize(filePath: string): Promise<void> {
    const { limits } = this.config;
    if (!limits?.maxFileSize) {
      return;
    }

    try {
      const stats = await stat(filePath);
      if (stats.size > limits.maxFileSize) {
        throw new Error(
          `File "${filePath}" exceeds max size limit (${stats.size} > ${limits.maxFileSize} bytes)`
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return; // File doesn't exist yet
      }
      throw error;
    }
  }

  private async computeFileHash(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath);
      return createHash("md5").update(content).digest("hex");
    } catch {
      return "";
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async createFileChange(
    path: string,
    type: FileChangeType
  ): Promise<FileChange> {
    const workspacePath = join(this.config.workspaceRoot, path);
    const sourcePath = join(this.config.sourceRoot, path);

    let diff: string | undefined;
    if (type === "modified") {
      diff = await this.computeDiff(sourcePath, workspacePath);
    }

    const risk = await this.assessRisk(path, type);

    return {
      path,
      type,
      diff,
      risk,
    };
  }

  private async computeDiff(sourcePath: string, workspacePath: string): Promise<string> {
    // Simple diff - just return file contents for now
    // In production, would use a proper diff library
    const sourceContent = await readFile(sourcePath, "utf-8");
    const workspaceContent = await readFile(workspacePath, "utf-8");

    const sourceLines = sourceContent.split("\n");
    const workspaceLines = workspaceContent.split("\n");

    let diff = "";
    const maxLines = Math.max(sourceLines.length, workspaceLines.length);

    for (let i = 0; i < maxLines; i++) {
      const sourceLine = sourceLines[i];
      const workspaceLine = workspaceLines[i];

      if (sourceLine !== workspaceLine) {
        if (sourceLine !== undefined) {
          diff += `-${sourceLine}\n`;
        }
        if (workspaceLine !== undefined) {
          diff += `+${workspaceLine}\n`;
        }
      }
    }

    return diff;
  }

  private async assessRisk(path: string, type: FileChangeType): Promise<ChangeRisk> {
    // Risk assessment based on file path and change type
    const lowerPath = path.toLowerCase();

    // Critical files
    if (
      lowerPath.includes("auth") ||
      lowerPath.includes("security") ||
      lowerPath.includes("password") ||
      lowerPath.includes("secret") ||
      lowerPath.includes("key")
    ) {
      return "critical";
    }

    // Config files
    if (
      lowerPath.endsWith(".config.js") ||
      lowerPath.endsWith(".config.ts") ||
      lowerPath.endsWith(".json") ||
      lowerPath.endsWith(".yaml") ||
      lowerPath.endsWith(".yml")
    ) {
      return "high";
    }

    // New files are lower risk
    if (type === "created") {
      return "low";
    }

    // Deleted files are higher risk
    if (type === "deleted") {
      return "high";
    }

    // Modified files - medium risk by default
    return "medium";
  }

  private async detectConflict(change: FileChange): Promise<boolean> {
    const sourcePath = join(this.config.sourceRoot, change.path);
    const currentHash = await this.computeFileHash(sourcePath);
    const originalHash = this.originalHashes.get(change.path);

    // If source file has changed since sync, there's a conflict
    if (currentHash !== originalHash) {
      change.conflict = {
        sourceModified: true,
        conflictType: "content",
      };
      return true;
    }

    return false;
  }

  private async mergeFile(change: FileChange): Promise<void> {
    const sourcePath = join(this.config.sourceRoot, change.path);
    const workspacePath = join(this.config.workspaceRoot, change.path);

    switch (change.type) {
      case "created":
      case "modified":
        // Copy from workspace to source
        await mkdir(dirname(sourcePath), { recursive: true });
        await cp(workspacePath, sourcePath, { force: true });
        break;

      case "deleted":
        // Delete from source
        await rm(sourcePath, { force: true });
        break;
    }
  }

  private emitTraceEvent(event: TraceEvent): void {
    this.traceWriter?.write(event);
  }
}
