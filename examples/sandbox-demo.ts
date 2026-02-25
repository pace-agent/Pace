/**
 * Pace Sandbox Demo
 *
 * 演示工作区隔离、变更检测和审批流
 *
 * 运行方式：
 *   npx tsx examples/sandbox-demo.ts
 */

import { SandboxManager, MergeManager } from "@pace-agent/sandbox";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---- Helpers ----

function separator(label: string) {
  const line = "─".repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║       Pace Sandbox Demo — Workspace Isolation           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  // 创建临时目录
  const tempDir = join(tmpdir(), `pace-sandbox-demo-${Date.now()}`);
  const sourceRoot = join(tempDir, "source");
  const workspaceRoot = join(tempDir, "workspace");

  await mkdir(sourceRoot, { recursive: true });

  console.log(`\n📁 源目录: ${sourceRoot}`);
  console.log(`📁 工作区: ${workspaceRoot}`);

  // ---- 1. 创建 SandboxManager ----
  separator("Step 1: 初始化 SandboxManager");

  const sandbox = new SandboxManager({
    config: {
      workspaceRoot,
      sourceRoot,
      deniedPaths: [".env", "secrets/*", "**/secret*"],
      networkMode: "allow",
      allowedDomains: ["api.anthropic.com", "api.openai.com"],
    },
  });

  await sandbox.initialize();
  console.log("  ✅ SandboxManager 已初始化");

  // ---- 2. 创建源文件 ----
  separator("Step 2: 创建源文件");

  const sourceFile = join(sourceRoot, "auth.ts");
  await writeFile(sourceFile, `
export async function authenticate(username: string, password: string) {
  // TODO: implement authentication
  return { success: false };
}
`.trim());

  console.log(`  📝 创建源文件: auth.ts`);
  const originalContent = await readFile(sourceFile, "utf-8");
  console.log(`  原始内容:\n${originalContent.split("\n").map((l) => `    ${l}`).join("\n")}`);

  // ---- 3. 同步到工作区 ----
  separator("Step 3: 同步文件到工作区");

  const workspacePath = await sandbox.syncToWorkspace("auth.ts");
  console.log(`  ✅ 文件已同步到工作区: ${workspacePath}`);

  // 检查源文件未被修改
  const sourceStillOriginal = await readFile(sourceFile, "utf-8");
  console.log(`  ✅ 源文件保持不变: ${sourceStillOriginal === originalContent ? "是" : "否"}`);

  // ---- 4. 模拟 Agent 修改 ----
  separator("Step 4: Agent 在工作区修改文件");

  const modifiedContent = `
import { RateLimiter } from "./rate-limiter";

const limiter = new RateLimiter({ windowMs: 60000, max: 100 });

export async function authenticate(username: string, password: string) {
  // Check rate limit first
  await limiter.check(username);

  // Validate credentials
  if (!username || !password) {
    throw new Error("Username and password required");
  }

  // TODO: implement actual authentication
  return { success: false };
}
`.trim();

  await writeFile(workspacePath, modifiedContent);
  console.log("  📝 Agent 修改了工作区文件");
  console.log(`  修改后内容:\n${modifiedContent.split("\n").map((l) => `    ${l}`).join("\n")}`);

  // ---- 5. 检测变更 ----
  separator("Step 5: 检测变更");

  const changes = await sandbox.getChanges();
  console.log(`  📊 检测到 ${changes.length} 个变更:`);

  for (const change of changes) {
    console.log(`     - ${change.path}: ${change.type} (风险: ${change.risk})`);
    if (change.diff) {
      console.log(`       Diff 预览:`);
      const diffLines = change.diff.split("\n").slice(0, 5);
      for (const line of diffLines) {
        console.log(`         ${line}`);
      }
    }
  }

  // ---- 6. 生成审批报告 ----
  separator("Step 6: 生成审批报告");

  const mergeManager = new MergeManager();
  const report = await mergeManager.generateReport(changes);

  console.log("  📋 变更报告:");
  console.log(`     总变更数: ${report.totalChanges}`);
  console.log(`     按风险分布:`);
  console.log(`       🔴 Critical: ${report.byRisk.critical.length}`);
  console.log(`       🟠 High: ${report.byRisk.high.length}`);
  console.log(`       🟡 Medium: ${report.byRisk.medium.length}`);
  console.log(`       🟢 Low: ${report.byRisk.low.length}`);
  console.log(`     冲突: ${report.conflicts.length}`);

  // CLI 格式化显示
  console.log("\n  " + mergeManager.formatForCLI(report));

  // ---- 7. 用户审批模拟 ----
  separator("Step 7: 模拟用户审批");

  console.log("  用户选择: Approve All");
  const decision = { type: "approve-all" as const };

  // ---- 8. 执行合并 ----
  separator("Step 8: 执行合并");

  const result = await sandbox.mergeToSource(changes);
  console.log(`  ✅ 合并结果:`);
  console.log(`     成功: ${result.success}`);
  console.log(`     合并文件: ${result.mergedFiles.join(", ")}`);
  console.log(`     跳过文件: ${result.skippedFiles.length}`);
  console.log(`     冲突: ${result.conflicts.length}`);

  // 验证源文件已更新
  const mergedContent = await readFile(sourceFile, "utf-8");
  console.log(`\n  📝 合并后源文件内容:\n${mergedContent.split("\n").map((l) => `    ${l}`).join("\n")}`);

  // ---- 9. 清理 ----
  separator("Step 9: 清理");

  await sandbox.destroy();
  console.log("  ✅ 工作区已清理");

  console.log("\n  ═══════════════════════════════════════════");
  console.log("  ✅ Sandbox Demo 完成!");
  console.log("  ═══════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n❌ Demo 失败:", err);
  process.exit(1);
});
