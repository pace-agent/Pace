import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type {
  ResourceProvider,
  ResourceType,
  L0Index,
  L1Preview,
  L2Payload,
  MemoryProvider,
  MemoryEntry,
  MemoryPriority,
} from "@pace-agent/core";

const PRIORITY_DIRS: Record<MemoryPriority, string> = {
  P0: "p0",
  P1: "p1",
  P2: "p2",
};

interface IndexFile {
  entries: MemoryEntry[];
}

/**
 * FileMemoryProvider — file-system-backed memory store.
 *
 * Directory layout:
 *   <rootDir>/
 *     .index.json          — metadata for all entries
 *     p0/<id>.md           — P0 (permanent/critical) content
 *     p1/<id>.md           — P1 (session-scoped) content
 *     p2/<id>.md           — P2 (ephemeral) content
 *
 * Implements both ResourceProvider (for ContextCompiler) and MemoryProvider
 * (for memory management operations).
 */
export class FileMemoryProvider implements ResourceProvider, MemoryProvider {
  readonly type: ResourceType = "memory";

  private readonly rootDir: string;
  private readonly indexPath: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, ".index.json");
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Ensure directory structure exists. Call before first use. */
  async init(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    for (const dir of Object.values(PRIORITY_DIRS)) {
      await fs.mkdir(path.join(this.rootDir, dir), { recursive: true });
    }
    // Create empty index if not present
    try {
      await fs.access(this.indexPath);
    } catch {
      await this.writeIndex({ entries: [] });
    }
  }

  // ── ResourceProvider ───────────────────────────────────────────────────────

  async listL0(): Promise<L0Index[]> {
    const { entries } = await this.readIndex();
    const now = Date.now();
    return entries
      .filter((e) => !this.isExpired(e, now))
      .map((e) => ({
        id: `memory:${e.id}`,
        name: e.name,
        description: e.description,
        type: "memory" as const,
        tags: e.tags,
        riskLevel: undefined,
      }));
  }

  async getL1(id: string): Promise<L1Preview> {
    const slug = this.stripPrefix(id);
    const entry = await this.findEntry(slug);
    const summary = await this.getSummary(slug);
    return {
      id,
      name: entry.name,
      description: entry.description,
      type: "memory" as const,
      tags: entry.tags,
      summary,
      constraints: `Priority: ${entry.priority}${entry.ttlDays ? ` | TTL: ${entry.ttlDays} days` : " | permanent"}`,
    };
  }

  async getL2(id: string): Promise<L2Payload> {
    const slug = this.stripPrefix(id);
    const entry = await this.findEntry(slug);
    const summary = await this.getSummary(slug);
    const fullContent = await this.getContent(slug);
    return {
      id,
      name: entry.name,
      description: entry.description,
      type: "memory" as const,
      tags: entry.tags,
      summary,
      fullContent,
      constraints: `Priority: ${entry.priority}${entry.ttlDays ? ` | TTL: ${entry.ttlDays} days` : " | permanent"}`,
    };
  }

  // ── MemoryProvider ─────────────────────────────────────────────────────────

  async list(): Promise<MemoryEntry[]> {
    const { entries } = await this.readIndex();
    const now = Date.now();
    return entries.filter((e) => !this.isExpired(e, now));
  }

  async getSummary(id: string): Promise<string> {
    const entry = await this.findEntry(id);
    const content = await this.readContent(entry);
    // Return first 500 chars as summary
    return content.length > 500 ? content.slice(0, 500) + "…" : content;
  }

  async getContent(id: string): Promise<string> {
    const entry = await this.findEntry(id);
    await this.touchEntry(id);
    return this.readContent(entry);
  }

  async write(
    meta: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "lastAccessedAt">,
    content: string,
  ): Promise<string> {
    const index = await this.readIndex();
    const now = Date.now();

    // Check if an entry with same name already exists → update
    const existing = index.entries.find((e) => e.name === meta.name);
    if (existing) {
      existing.description = meta.description;
      existing.priority = meta.priority;
      existing.tags = meta.tags;
      existing.ttlDays = meta.ttlDays;
      existing.updatedAt = now;
      existing.lastAccessedAt = now;
      await this.writeIndex(index);
      await this.writeContent(existing, content);
      return existing.id;
    }

    // New entry
    const id = crypto.randomUUID();
    const entry: MemoryEntry = {
      id,
      ...meta,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    };
    index.entries.push(entry);
    await this.writeIndex(index);
    await this.writeContent(entry, content);
    return id;
  }

  async delete(id: string): Promise<void> {
    const index = await this.readIndex();
    const idx = index.entries.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Memory entry not found: ${id}`);
    const [entry] = index.entries.splice(idx, 1) as [MemoryEntry];
    await this.writeIndex(index);
    const filePath = this.contentPath(entry);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async readIndex(): Promise<IndexFile> {
    try {
      const raw = await fs.readFile(this.indexPath, "utf8");
      return JSON.parse(raw) as IndexFile;
    } catch {
      return { entries: [] };
    }
  }

  private async writeIndex(index: IndexFile): Promise<void> {
    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2), "utf8");
  }

  private contentPath(entry: MemoryEntry): string {
    return path.join(this.rootDir, PRIORITY_DIRS[entry.priority], `${entry.id}.md`);
  }

  private async readContent(entry: MemoryEntry): Promise<string> {
    return fs.readFile(this.contentPath(entry), "utf8");
  }

  private async writeContent(entry: MemoryEntry, content: string): Promise<void> {
    const dir = path.join(this.rootDir, PRIORITY_DIRS[entry.priority]);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.contentPath(entry), content, "utf8");
  }

  private async findEntry(id: string): Promise<MemoryEntry> {
    const { entries } = await this.readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error(`Memory entry not found: ${id}`);
    return entry;
  }

  private async touchEntry(id: string): Promise<void> {
    const index = await this.readIndex();
    const entry = index.entries.find((e) => e.id === id);
    if (entry) {
      entry.lastAccessedAt = Date.now();
      await this.writeIndex(index);
    }
  }

  private isExpired(entry: MemoryEntry, now: number): boolean {
    if (!entry.ttlDays) return false;
    const expiresAt = entry.createdAt + entry.ttlDays * 24 * 60 * 60 * 1000;
    return now > expiresAt;
  }

  private stripPrefix(id: string): string {
    return id.startsWith("memory:") ? id.slice("memory:".length) : id;
  }
}
