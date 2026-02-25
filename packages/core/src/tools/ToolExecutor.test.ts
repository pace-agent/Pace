import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ToolExecutor } from "./ToolExecutor.js";
import { builtinTools } from "./builtin.js";
import type { ToolDefinition, ToolCall } from "./types.js";

describe("ToolExecutor", () => {
  let tempDir: string;
  let executor: ToolExecutor;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `tool-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    executor = new ToolExecutor({ cwd: tempDir });
    for (const { definition, handler } of builtinTools) {
      executor.register(definition, handler);
    }
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should register tools", () => {
    expect(executor.has("read_file")).toBe(true);
    expect(executor.getDefinitions().length).toBe(4);
  });

  it("should read file", async () => {
    await writeFile(join(tempDir, "test.txt"), "Hello");
    const result = await executor.execute({
      id: "1", name: "read_file", params: { path: "test.txt" }
    });
    expect(result.success).toBe(true);
  });

  it("should write file", async () => {
    const result = await executor.execute({
      id: "2", name: "write_file", params: { path: "out.txt", content: "data" }
    });
    expect(result.success).toBe(true);
  });

  it("should list directory", async () => {
    await writeFile(join(tempDir, "a.txt"), "a");
    const result = await executor.execute({
      id: "3", name: "list_directory", params: { path: "." }
    });
    expect(result.success).toBe(true);
  });

  it("should check file exists", async () => {
    const result = await executor.execute({
      id: "4", name: "file_exists", params: { path: "no.txt" }
    });
    expect(result.success).toBe(true);
    expect(JSON.parse(result.content).exists).toBe(false);
  });

  it("should fail for unknown tool", async () => {
    const result = await executor.execute({
      id: "5", name: "unknown", params: {}
    });
    expect(result.success).toBe(false);
  });
});
