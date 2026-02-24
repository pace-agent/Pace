import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { FileMemoryProvider } from "./FileMemoryProvider.js";

let tmpDir: string;
let provider: FileMemoryProvider;

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `pace-mem-test-${Date.now()}`);
  provider = new FileMemoryProvider(tmpDir);
  await provider.init();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("FileMemoryProvider — init", () => {
  it("creates root dir and p0/p1/p2 subdirectories", async () => {
    for (const dir of ["p0", "p1", "p2"]) {
      const stat = await fs.stat(path.join(tmpDir, dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it("creates an empty .index.json", async () => {
    const raw = await fs.readFile(path.join(tmpDir, ".index.json"), "utf8");
    expect(JSON.parse(raw)).toEqual({ entries: [] });
  });
});

describe("FileMemoryProvider — write & list", () => {
  it("writes a new entry and lists it", async () => {
    const id = await provider.write(
      { name: "Test Note", description: "A test note", priority: "P1", tags: ["test"] },
      "Hello world",
    );
    expect(typeof id).toBe("string");

    const entries = await provider.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("Test Note");
    expect(entries[0]!.id).toBe(id);
  });

  it("updating an entry by same name overwrites content", async () => {
    await provider.write({ name: "Dup", description: "d", priority: "P0", tags: [] }, "v1");
    await provider.write({ name: "Dup", description: "d updated", priority: "P0", tags: [] }, "v2");
    const entries = await provider.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.description).toBe("d updated");
  });
});

describe("FileMemoryProvider — ResourceProvider interface", () => {
  it("listL0 returns entries with memory: prefix", async () => {
    await provider.write({ name: "Ctx", description: "context", priority: "P0", tags: ["ctx"] }, "data");
    const l0 = await provider.listL0();
    expect(l0).toHaveLength(1);
    expect(l0[0]!.id).toMatch(/^memory:/);
    expect(l0[0]!.type).toBe("memory");
  });

  it("getL1 returns L1Preview with summary", async () => {
    const rawId = await provider.write({ name: "Notes", description: "notes", priority: "P1", tags: ["note"] }, "line1\nline2");
    const l1 = await provider.getL1(`memory:${rawId}`);
    expect(l1.summary).toContain("line1");
    expect(l1.id).toBe(`memory:${rawId}`);
  });

  it("getL2 returns full content", async () => {
    const rawId = await provider.write({ name: "Full", description: "f", priority: "P2", tags: [] }, "full content here");
    const l2 = await provider.getL2(`memory:${rawId}`);
    expect(l2.fullContent).toBe("full content here");
  });
});

describe("FileMemoryProvider — TTL filtering", () => {
  it("filters out expired entries in list()", async () => {
    // Write an entry with ttlDays=-1 (already expired)
    const index = path.join(tmpDir, ".index.json");
    const id = await provider.write({ name: "Old", description: "old", priority: "P2", tags: [], ttlDays: 1 }, "data");

    // Manually expire it by backdating createdAt
    const raw = JSON.parse(await fs.readFile(index, "utf8"));
    const entry = raw.entries.find((e: { id: string }) => e.id === id);
    entry.createdAt = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
    await fs.writeFile(index, JSON.stringify(raw), "utf8");

    const entries = await provider.list();
    expect(entries).toHaveLength(0);
  });

  it("non-expiring entries always appear", async () => {
    await provider.write({ name: "Perm", description: "permanent", priority: "P0", tags: [] }, "content");
    const entries = await provider.list();
    expect(entries).toHaveLength(1);
  });
});

describe("FileMemoryProvider — delete", () => {
  it("removes entry from index and file", async () => {
    const id = await provider.write({ name: "Del", description: "del", priority: "P1", tags: [] }, "bye");
    await provider.delete(id);
    const entries = await provider.list();
    expect(entries).toHaveLength(0);
  });

  it("throws when deleting non-existent id", async () => {
    await expect(provider.delete("does-not-exist")).rejects.toThrow("not found");
  });
});
