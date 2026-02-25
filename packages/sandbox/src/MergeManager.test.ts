import { describe, it, expect, vi, beforeEach } from "vitest";
import { MergeManager, type ChangeReport, type ApprovalDecision } from "./MergeManager.js";
import type { FileChange, MergeResult } from "./types/sandbox.js";

describe("MergeManager", () => {
  let manager: MergeManager;

  beforeEach(() => {
    manager = new MergeManager();
  });

  describe("generateReport", () => {
    it("should generate report with correct totals", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low" },
        { path: "b.ts", type: "created", risk: "medium" },
        { path: "c.ts", type: "deleted", risk: "high" },
      ];

      const report = await manager.generateReport(changes);

      expect(report.totalChanges).toBe(3);
      expect(report.byRisk.low).toHaveLength(1);
      expect(report.byRisk.medium).toHaveLength(1);
      expect(report.byRisk.high).toHaveLength(1);
      expect(report.byRisk.critical).toHaveLength(0);
    });

    it("should group changes by risk level", async () => {
      const changes: FileChange[] = [
        { path: "auth.ts", type: "modified", risk: "critical" },
        { path: "config.json", type: "modified", risk: "high" },
        { path: "utils.ts", type: "modified", risk: "medium" },
        { path: "readme.md", type: "modified", risk: "low" },
      ];

      const report = await manager.generateReport(changes);

      expect(report.byRisk.critical).toHaveLength(1);
      expect(report.byRisk.critical[0].path).toBe("auth.ts");

      expect(report.byRisk.high).toHaveLength(1);
      expect(report.byRisk.high[0].path).toBe("config.json");

      expect(report.byRisk.medium).toHaveLength(1);
      expect(report.byRisk.medium[0].path).toBe("utils.ts");

      expect(report.byRisk.low).toHaveLength(1);
      expect(report.byRisk.low[0].path).toBe("readme.md");
    });

    it("should detect conflicts", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low" },
        {
          path: "b.ts",
          type: "modified",
          risk: "medium",
          conflict: { sourceModified: true, conflictType: "content" },
        },
        {
          path: "c.ts",
          type: "modified",
          risk: "high",
          conflict: { sourceModified: true, conflictType: "deleted" },
        },
      ];

      const report = await manager.generateReport(changes);

      expect(report.conflicts).toHaveLength(2);
      expect(report.conflicts.map((c) => c.path)).toContain("b.ts");
      expect(report.conflicts.map((c) => c.path)).toContain("c.ts");
    });

    it("should collect diffs", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low", diff: "-old\n+new" },
        { path: "b.ts", type: "modified", risk: "medium" },
      ];

      const report = await manager.generateReport(changes);

      expect(report.detailedDiffs.size).toBe(1);
      expect(report.detailedDiffs.get("a.ts")).toBe("-old\n+new");
    });

    it("should generate summary text", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "critical" },
        { path: "b.ts", type: "modified", risk: "high" },
        { path: "c.ts", type: "modified", risk: "low" },
      ];

      const report = await manager.generateReport(changes);

      expect(report.summary).toContain("3 file(s)");
      expect(report.summary).toContain("critical");
      expect(report.summary).toContain("high");
      expect(report.summary).toContain("low");
    });
  });

  describe("assessRisk", () => {
    it("should return the risk from the change", () => {
      const change: FileChange = { path: "test.ts", type: "modified", risk: "critical" };

      expect(manager.assessRisk(change)).toBe("critical");
    });
  });

  describe("detectConflicts", () => {
    it("should return only changes with conflicts", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low" },
        {
          path: "b.ts",
          type: "modified",
          risk: "medium",
          conflict: { sourceModified: true, conflictType: "content" },
        },
      ];

      const conflicts = await manager.detectConflicts(changes);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].path).toBe("b.ts");
    });
  });

  describe("requestApproval", () => {
    it("should use callback if provided", async () => {
      const mockCallback = vi.fn().mockResolvedValue({ type: "approve-all" } as ApprovalDecision);

      const managerWithCallback = new MergeManager({
        requestApproval: mockCallback,
      });

      const report: ChangeReport = {
        totalChanges: 1,
        byRisk: { low: [], medium: [], high: [], critical: [] },
        conflicts: [],
        summary: "test",
        detailedDiffs: new Map(),
      };

      const decision = await managerWithCallback.requestApproval(report);

      expect(mockCallback).toHaveBeenCalledWith(report);
      expect(decision.type).toBe("approve-all");
    });

    it("should default to approve-all if no callback", async () => {
      const report: ChangeReport = {
        totalChanges: 1,
        byRisk: { low: [], medium: [], high: [], critical: [] },
        conflicts: [],
        summary: "test",
        detailedDiffs: new Map(),
      };

      const decision = await manager.requestApproval(report);

      expect(decision.type).toBe("approve-all");
    });
  });

  describe("executeMerge", () => {
    const mockMergeFn = vi.fn();

    beforeEach(() => {
      mockMergeFn.mockReset();
      mockMergeFn.mockResolvedValue({
        success: true,
        mergedFiles: [],
        skippedFiles: [],
        conflicts: [],
      });
    });

    it("should merge all changes on approve-all", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low" },
        { path: "b.ts", type: "modified", risk: "medium" },
      ];

      const decision: ApprovalDecision = { type: "approve-all" };

      await manager.executeMerge(changes, decision, mockMergeFn);

      expect(mockMergeFn).toHaveBeenCalledWith(changes);
    });

    it("should merge only selected files on approve-selected", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low" },
        { path: "b.ts", type: "modified", risk: "medium" },
        { path: "c.ts", type: "modified", risk: "high" },
      ];

      const decision: ApprovalDecision = {
        type: "approve-selected",
        files: ["a.ts", "c.ts"],
      };

      await manager.executeMerge(changes, decision, mockMergeFn);

      expect(mockMergeFn).toHaveBeenCalledWith([
        changes[0],
        changes[2],
      ]);
    });

    it("should skip all files on reject-all", async () => {
      const changes: FileChange[] = [
        { path: "a.ts", type: "modified", risk: "low" },
        { path: "b.ts", type: "modified", risk: "medium" },
      ];

      const decision: ApprovalDecision = { type: "reject-all" };

      const result = await manager.executeMerge(changes, decision, mockMergeFn);

      expect(mockMergeFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.skippedFiles).toContain("a.ts");
      expect(result.skippedFiles).toContain("b.ts");
    });
  });

  describe("formatForCLI", () => {
    it("should format report for display", () => {
      const report: ChangeReport = {
        totalChanges: 3,
        byRisk: {
          critical: [{ path: "auth.ts", type: "modified", risk: "critical" }],
          high: [],
          medium: [{ path: "config.ts", type: "modified", risk: "medium" }],
          low: [{ path: "readme.md", type: "modified", risk: "low" }],
        },
        conflicts: [],
        summary: "test",
        detailedDiffs: new Map(),
      };

      const formatted = manager.formatForCLI(report);

      expect(formatted).toContain("Change Report");
      expect(formatted).toContain("Files changed: 3");
      expect(formatted).toContain("CRITICAL");
      expect(formatted).toContain("MEDIUM");
      expect(formatted).toContain("LOW");
      expect(formatted).toContain("[A] Approve all");
    });

    it("should include conflicts in display", () => {
      const report: ChangeReport = {
        totalChanges: 1,
        byRisk: { low: [], medium: [], high: [], critical: [] },
        conflicts: [
          {
            path: "conflict.ts",
            type: "modified",
            risk: "high",
            conflict: { sourceModified: true, conflictType: "content" },
          },
        ],
        summary: "test",
        detailedDiffs: new Map(),
      };

      const formatted = manager.formatForCLI(report);

      expect(formatted).toContain("Conflicts: 1");
      expect(formatted).toContain("conflict.ts");
    });
  });

  describe("formatDiffForCLI", () => {
    it("should format diff for display", () => {
      const change: FileChange = {
        path: "test.ts",
        type: "modified",
        risk: "medium",
        diff: "-old line\n+new line",
      };

      const formatted = manager.formatDiffForCLI(change);

      expect(formatted).toContain("test.ts");
      expect(formatted).toContain("MODIFIED");
      expect(formatted).toContain("-old line");
      expect(formatted).toContain("+new line");
    });

    it("should show type labels", () => {
      const created: FileChange = { path: "new.ts", type: "created", risk: "low" };
      const deleted: FileChange = { path: "old.ts", type: "deleted", risk: "low" };

      expect(manager.formatDiffForCLI(created)).toContain("CREATED");
      expect(manager.formatDiffForCLI(deleted)).toContain("DELETED");
    });

    it("should show risk emoji", () => {
      const critical: FileChange = { path: "auth.ts", type: "modified", risk: "critical" };
      const high: FileChange = { path: "config.ts", type: "modified", risk: "high" };

      expect(manager.formatDiffForCLI(critical)).toContain("🔴");
      expect(manager.formatDiffForCLI(high)).toContain("🟠");
    });
  });

  describe("displayDiff", () => {
    it("should call callback if provided", () => {
      const mockDisplayDiff = vi.fn();

      const managerWithCallback = new MergeManager({
        displayDiff: mockDisplayDiff,
      });

      managerWithCallback.displayDiff("test.ts", "-old\n+new");

      expect(mockDisplayDiff).toHaveBeenCalledWith("test.ts", "-old\n+new");
    });

    it("should log to console if no callback", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      manager.displayDiff("test.ts", "-old\n+new");

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});
