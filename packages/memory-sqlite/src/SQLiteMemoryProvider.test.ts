import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteMemoryProvider } from "./SQLiteMemoryProvider.js";

let provider: SQLiteMemoryProvider;

beforeEach(() => {
  // Use in-memory database for isolation
  provider = new SQLiteMemoryProvider({ dbPath: ":memory:" });
});

afterEach(() => {
  provider.close();
});

describe("SQLiteMemoryProvider", () => {
  it("initialises schema without errors", () => {
    // Constructor itself sets up schema — if we get here it worked
    expect(provider).toBeDefined();
  });

  it("writes an entry and lists it back", async () => {
    const id = await provider.write(
      { name: "My Note", description: "A test note", priority: "P1", tags: ["test"] },
      "Hello, memory!",
    );

    expect(typeof id).toBe("string");
    const entries = await provider.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("My Note");
    expect(entries[0]!.priority).toBe("P1");
  });

  it("upserts entry by name — updates existing instead of inserting new", async () => {
    const id1 = await provider.write(
      { name: "Same Name", description: "v1", priority: "P1", tags: [] },
      "content v1",
    );
    const id2 = await provider.write(
      { name: "Same Name", description: "v2", priority: "P2", tags: ["updated"] },
      "content v2",
    );

    expect(id1).toBe(id2); // same row was updated
    const entries = await provider.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.description).toBe("v2");
    expect(entries[0]!.priority).toBe("P2");
  });

  it("filters expired TTL entries from list", async () => {
    await provider.write(
      { name: "Permanent", description: "", priority: "P0", tags: [], ttlDays: undefined },
      "keep me",
    );
    await provider.write(
      { name: "Expired", description: "", priority: "P2", tags: [], ttlDays: -1 }, // already expired
      "delete me",
    );

    const entries = await provider.list();
    expect(entries.map((e) => e.name)).toContain("Permanent");
    expect(entries.map((e) => e.name)).not.toContain("Expired");
  });

  it("does not expire permanent entries (no ttlDays)", async () => {
    await provider.write(
      { name: "Forever", description: "", priority: "P0", tags: [] },
      "content",
    );

    const entries = await provider.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.ttlDays).toBeUndefined();
  });

  it("L0 ids have memory: prefix", async () => {
    await provider.write(
      { name: "Note", description: "A note", priority: "P1", tags: ["tag"] },
      "content",
    );

    const l0 = await provider.listL0();
    expect(l0).toHaveLength(1);
    expect(l0[0]!.id).toMatch(/^memory:/);
    expect(l0[0]!.type).toBe("memory");
  });

  it("L1 preview summary is truncated to summaryMaxChars", async () => {
    const maxChars = 50;
    const longContent = "x".repeat(200);
    const smallProvider = new SQLiteMemoryProvider({
      dbPath: ":memory:",
      summaryMaxChars: maxChars,
    });

    await smallProvider.write(
      { name: "Long Note", description: "", priority: "P1", tags: [] },
      longContent,
    );

    const l0 = await smallProvider.listL0();
    const l1 = await smallProvider.getL1(l0[0]!.id);
    expect(l1.summary.length).toBeLessThanOrEqual(maxChars + 1); // +1 for ellipsis char
    expect(l1.summary.endsWith("\u2026")).toBe(true);

    smallProvider.close();
  });

  it("L2 getL2 returns full content without truncation", async () => {
    const fullContent = "z".repeat(600);
    await provider.write(
      { name: "Big Note", description: "", priority: "P1", tags: [] },
      fullContent,
    );

    const l0 = await provider.listL0();
    const l2 = await provider.getL2(l0[0]!.id);
    expect(l2.fullContent).toBe(fullContent);
  });

  it("delete removes the entry", async () => {
    const id = await provider.write(
      { name: "Temp", description: "", priority: "P2", tags: [] },
      "bye",
    );

    await provider.delete(id);
    const entries = await provider.list();
    expect(entries).toHaveLength(0);
  });

  it("delete throws for non-existent id", async () => {
    await expect(provider.delete("nonexistent-id")).rejects.toThrow("not found");
  });
});
