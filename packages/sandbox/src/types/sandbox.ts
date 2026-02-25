// ---- Sandbox Types ----

/**
 * SandboxConfig — Configuration for workspace isolation.
 */
export interface SandboxConfig {
  /** Root directory of the isolated workspace */
  workspaceRoot: string;

  /** Root directory of the source files (original location) */
  sourceRoot: string;

  /** Path patterns that are denied access (highest priority) */
  deniedPaths: string[];

  /** Additional paths allowed for read-only access */
  readOnlyPaths?: string[];

  /** Network isolation mode */
  networkMode: "isolated" | "allow" | "proxy";

  /** Allowed domains when networkMode is 'allow' */
  allowedDomains?: string[];

  /** Resource limits */
  limits?: SandboxLimits;
}

/**
 * Resource limits for the sandbox.
 */
export interface SandboxLimits {
  /** Maximum single file size in bytes */
  maxFileSize?: number;

  /** Maximum total workspace size in bytes */
  maxTotalSize?: number;

  /** Operation timeout in milliseconds */
  timeoutMs?: number;
}

/**
 * Type of file change.
 */
export type FileChangeType = "created" | "modified" | "deleted";

/**
 * Risk level for a file change.
 */
export type ChangeRisk = "low" | "medium" | "high" | "critical";

/**
 * Conflict information when source file also changed.
 */
export interface FileConflict {
  /** Whether the source file was modified after being synced */
  sourceModified: boolean;

  /** Type of conflict */
  conflictType: "content" | "deleted" | "created";
}

/**
 * File change record.
 */
export interface FileChange {
  /** File path relative to sourceRoot */
  path: string;

  /** Type of change */
  type: FileChangeType;

  /** Unified diff for modified files */
  diff?: string;

  /** Assessed risk level */
  risk: ChangeRisk;

  /** Conflict information if any */
  conflict?: FileConflict;
}

/**
 * Options for merging changes.
 */
export interface MergeOptions {
  /** Skip conflict detection */
  skipConflictCheck?: boolean;

  /** Strategy for handling conflicts */
  conflictStrategy?: "abort" | "overwrite" | "merge";
}

/**
 * Result of a merge operation.
 */
export interface MergeResult {
  /** Whether the merge succeeded */
  success: boolean;

  /** Files that were successfully merged */
  mergedFiles: string[];

  /** Files that were skipped */
  skippedFiles: string[];

  /** Files with conflicts that prevented merge */
  conflicts: FileChange[];

  /** Error message if merge failed */
  error?: string;
}
