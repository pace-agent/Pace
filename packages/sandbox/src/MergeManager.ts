import type { FileChange, ChangeRisk, MergeOptions, MergeResult } from "@pace-agent/sandbox";

/**
 * ChangeReport — Summary of all changes for review.
 */
export interface ChangeReport {
  /** Total number of changes */
  totalChanges: number;

  /** Changes grouped by risk level */
  byRisk: {
    low: FileChange[];
    medium: FileChange[];
    high: FileChange[];
    critical: FileChange[];
  };

  /** Files with conflicts */
  conflicts: FileChange[];

  /** Summary text for CLI display */
  summary: string;

  /** Detailed diffs for each file */
  detailedDiffs: Map<string, string>;
}

/**
 * User's approval decision.
 */
export type ApprovalDecision =
  | { type: "approve-all" }
  | { type: "approve-selected"; files: string[] }
  | { type: "reject-all" }
  | { type: "review-file"; file: string };

/**
 * MergeManagerOptions — Options for creating a MergeManager.
 */
export interface MergeManagerOptions {
  /** Callback to request user approval */
  requestApproval?: (report: ChangeReport) => Promise<ApprovalDecision>;

  /** Callback to display diff for a file */
  displayDiff?: (path: string, diff: string) => void;
}

/**
 * MergeManager — Handles the approval workflow for merging changes.
 *
 * This class implements the approval flow from v0.2 design.
 * It generates change reports, assesses risks, and manages the
 * user approval process before merging changes.
 *
 * Key features:
 * - Risk assessment for file changes
 * - Conflict detection
 * - Change report generation
 * - CLI approval interaction
 * - Atomic merge execution
 *
 * @example
 * ```typescript
 * const mergeManager = new MergeManager({
 *   requestApproval: async (report) => {
 *     console.log(report.summary);
 *     const answer = await promptUser('Approve all? (y/n)');
 *     return answer === 'y' ? { type: 'approve-all' } : { type: 'reject-all' };
 *   },
 * });
 *
 * const report = await mergeManager.generateReport(changes);
 * const decision = await mergeManager.requestApproval(report);
 * const result = await mergeManager.executeMerge(changes, decision);
 * ```
 */
export class MergeManager {
  private readonly requestApprovalCallback?: (report: ChangeReport) => Promise<ApprovalDecision>;
  private readonly displayDiffCallback?: (path: string, diff: string) => void;

  constructor(options: MergeManagerOptions = {}) {
    this.requestApprovalCallback = options.requestApproval;
    this.displayDiffCallback = options.displayDiff;
  }

  /**
   * Generate a change report for review.
   *
   * @param changes - Array of file changes
   * @returns Structured change report
   */
  async generateReport(changes: FileChange[]): Promise<ChangeReport> {
    const byRisk: ChangeReport["byRisk"] = {
      low: [],
      medium: [],
      high: [],
      critical: [],
    };

    const conflicts: FileChange[] = [];
    const detailedDiffs = new Map<string, string>();

    for (const change of changes) {
      // Group by risk
      byRisk[change.risk].push(change);

      // Collect conflicts
      if (change.conflict) {
        conflicts.push(change);
      }

      // Store diff
      if (change.diff) {
        detailedDiffs.set(change.path, change.diff);
      }
    }

    const summary = this.generateSummary(changes, byRisk, conflicts);

    return {
      totalChanges: changes.length,
      byRisk,
      conflicts,
      summary,
      detailedDiffs,
    };
  }

  /**
   * Assess the risk level of a file change.
   *
   * @param change - The file change to assess
   * @returns Risk level
   */
  assessRisk(change: FileChange): ChangeRisk {
    // Use existing risk assessment from the change
    // This method can be extended for custom risk logic
    return change.risk;
  }

  /**
   * Detect conflicts in the changes.
   *
   * @param changes - Array of file changes
   * @returns Changes with conflicts
   */
  async detectConflicts(changes: FileChange[]): Promise<FileChange[]> {
    return changes.filter((change) => change.conflict !== undefined);
  }

  /**
   * Request user approval for the changes.
   *
   * @param report - The change report
   * @returns User's approval decision
   */
  async requestApproval(report: ChangeReport): Promise<ApprovalDecision> {
    if (this.requestApprovalCallback) {
      return this.requestApprovalCallback(report);
    }

    // Default: approve all if no callback provided
    return { type: "approve-all" };
  }

  /**
   * Display diff for a specific file.
   *
   * @param path - File path
   * @param diff - The diff content
   */
  displayDiff(path: string, diff: string): void {
    if (this.displayDiffCallback) {
      this.displayDiffCallback(path, diff);
    } else {
      // Default: log to console
      console.log(`\n--- ${path} ---\n${diff}\n`);
    }
  }

  /**
   * Execute the merge based on user decision.
   *
   * @param changes - All file changes
   * @param decision - User's approval decision
   * @param mergeFn - Function to perform the actual merge
   * @returns Merge result
   */
  async executeMerge(
    changes: FileChange[],
    decision: ApprovalDecision,
    mergeFn: (selectedChanges: FileChange[]) => Promise<MergeResult>
  ): Promise<MergeResult> {
    switch (decision.type) {
      case "approve-all":
        return mergeFn(changes);

      case "approve-selected":
        const selectedChanges = changes.filter((c) =>
          decision.files.includes(c.path)
        );
        return mergeFn(selectedChanges);

      case "reject-all":
        return {
          success: false,
          mergedFiles: [],
          skippedFiles: changes.map((c) => c.path),
          conflicts: [],
        };

      case "review-file":
        // This shouldn't reach here in normal flow
        // The caller should handle review-file separately
        return {
          success: false,
          mergedFiles: [],
          skippedFiles: changes.map((c) => c.path),
          conflicts: [],
          error: "Review-file decision requires re-processing",
        };
    }
  }

  /**
   * Format a change report for CLI display.
   *
   * @param report - The change report
   * @returns Formatted string for display
   */
  formatForCLI(report: ChangeReport): string {
    const lines: string[] = [];

    lines.push("┌" + "─".repeat(50) + "┐");
    lines.push("│" + this.center("Change Report", 50) + "│");
    lines.push("├" + "─".repeat(50) + "┤");

    // Summary
    lines.push("│" + ` Files changed: ${report.totalChanges}`.padEnd(50) + "│");
    lines.push("├" + "─".repeat(50) + "┤");

    // By risk
    const riskLabels: ChangeRisk[] = ["critical", "high", "medium", "low"];
    const riskColors: Record<ChangeRisk, string> = {
      critical: "🔴",
      high: "🟠",
      medium: "🟡",
      low: "🟢",
    };

    for (const risk of riskLabels) {
      const count = report.byRisk[risk].length;
      if (count > 0) {
        const emoji = riskColors[risk];
        lines.push("│" + ` ${emoji} ${risk.toUpperCase()}: ${count} file(s)`.padEnd(50) + "│");
      }
    }

    // Conflicts
    if (report.conflicts.length > 0) {
      lines.push("├" + "─".repeat(50) + "┤");
      lines.push("│" + ` ⚠️  Conflicts: ${report.conflicts.length}`.padEnd(50) + "│");
      for (const conflict of report.conflicts) {
        const truncated = conflict.path.length > 40 ? "..." + conflict.path.slice(-37) : conflict.path;
        lines.push("│" + `    - ${truncated}`.padEnd(50) + "│");
      }
    }

    lines.push("├" + "─".repeat(50) + "┤");

    // Actions
    lines.push("│" + " [A] Approve all  [S] Select files  [V] View diff".padEnd(50) + "│");
    lines.push("│" + " [R] Reject all   [?] Help".padEnd(50) + "│");
    lines.push("└" + "─".repeat(50) + "┘");

    return lines.join("\n");
  }

  /**
   * Format a single file diff for CLI display.
   *
   * @param change - The file change
   * @returns Formatted diff string
   */
  formatDiffForCLI(change: FileChange): string {
    const lines: string[] = [];
    const width = 60;

    const riskEmoji: Record<ChangeRisk, string> = {
      critical: "🔴",
      high: "🟠",
      medium: "🟡",
      low: "🟢",
    };

    const typeLabel = {
      created: "CREATED",
      modified: "MODIFIED",
      deleted: "DELETED",
    };

    lines.push("┌" + "─".repeat(width) + "┐");
    const header = ` ${riskEmoji[change.risk]} ${change.path} (${typeLabel[change.type]})`;
    lines.push("│" + header.padEnd(width) + "│");
    lines.push("├" + "─".repeat(width) + "┤");

    if (change.diff) {
      const diffLines = change.diff.split("\n").slice(0, 20); // Limit to 20 lines
      for (const line of diffLines) {
        const prefix = line.startsWith("+") ? "+" : line.startsWith("-") ? "-" : " ";
        const color = line.startsWith("+") ? "\x1b[32m" : line.startsWith("-") ? "\x1b[31m" : "";
        const truncated = line.slice(0, width - 4);
        lines.push("│ " + color + truncated + "\x1b[0m".padEnd(width - 2) + "│");
      }
      if (change.diff.split("\n").length > 20) {
        lines.push("│" + " ... (truncated)".padEnd(width) + "│");
      }
    } else {
      lines.push("│" + " (no diff available)".padEnd(width) + "│");
    }

    lines.push("└" + "─".repeat(width) + "┘");

    return lines.join("\n");
  }

  // ---- Private Helper Methods ----

  private generateSummary(
    changes: FileChange[],
    byRisk: ChangeReport["byRisk"],
    conflicts: FileChange[]
  ): string {
    const parts: string[] = [];

    parts.push(`Total: ${changes.length} file(s) changed`);

    const riskParts: string[] = [];
    if (byRisk.critical.length > 0) riskParts.push(`🔴 ${byRisk.critical.length} critical`);
    if (byRisk.high.length > 0) riskParts.push(`🟠 ${byRisk.high.length} high`);
    if (byRisk.medium.length > 0) riskParts.push(`🟡 ${byRisk.medium.length} medium`);
    if (byRisk.low.length > 0) riskParts.push(`🟢 ${byRisk.low.length} low`);

    if (riskParts.length > 0) {
      parts.push(`Risk: ${riskParts.join(", ")}`);
    }

    if (conflicts.length > 0) {
      parts.push(`⚠️ ${conflicts.length} conflict(s) detected`);
    }

    return parts.join("\n");
  }

  private center(text: string, width: number): string {
    const padding = Math.floor((width - text.length) / 2);
    return " ".repeat(Math.max(0, padding)) + text + " ".repeat(Math.max(0, width - text.length - padding));
  }
}
