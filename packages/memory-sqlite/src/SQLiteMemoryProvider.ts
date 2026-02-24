import Database from "better-sqlite3";
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

export interface SQLiteMemoryProviderOptions {
  /** Path to the SQLite database file. Use ":memory:" for in-process tests. Default: ".pace/memory.db" */
  dbPath?: string;
  /** Max characters for L1 summary preview. Default: 500 (matches FileMemoryProvider) */
  summaryMaxChars?: number;
  /** Enable WAL journal mode for better concurrency. Default: true (:memory: ignores this safely) */
  wal?: boolean;
}

const PRIORITY_VALUES: MemoryPriority[] = ["P0", "P1", "P2"];

function isValidPriority(p: unknown): p is MemoryPriority {
  return PRIORITY_VALUES.includes(p as MemoryPriority);
}

interface EntryRow {
  id: string;
  name: string;
  description: string;
  priority: string;
  tags: string;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
  ttl_days: number | null;
}

/**
 * SQLiteMemoryProvider — SQLite-backed memory store.
 *
 * Drop-in replacement for FileMemoryProvider:
 *   - Same ResourceProvider + MemoryProvider interfaces
 *   - Same L0 id prefix ("memory:")
 *   - Same 500-char summary truncation
 *   - TTL filtering via SQL
 *   - FTS5 virtual table for future full-text search
 */
export class SQLiteMemoryProvider implements ResourceProvider, MemoryProvider {
  readonly type: ResourceType = "memory";

  private readonly db: Database.Database;
  private readonly summaryMaxChars: number;

  private readonly stmts: {
    insertEntry: Database.Statement;
    insertContent: Database.Statement;
    updateEntry: Database.Statement;
    updateContent: Database.Statement;
    findByName: Database.Statement;
    findById: Database.Statement;
    listLive: Database.Statement;
    getContent: Database.Statement;
    deleteEntry: Database.Statement;
    touchEntry: Database.Statement;
  };

  constructor(options?: SQLiteMemoryProviderOptions) {
    const dbPath = options?.dbPath ?? ".pace/memory.db";
    this.summaryMaxChars = options?.summaryMaxChars ?? 500;

    this.db = new Database(dbPath);

    if ((options?.wal ?? true) && dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
    }

    this.initSchema();
    this.stmts = this.prepareStatements();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** No-op — schema is initialised in constructor. Provided for API parity with FileMemoryProvider. */
  async init(): Promise<void> {}

  /** Close the database connection. */
  close(): void {
    this.db.close();
  }

  // ── ResourceProvider ───────────────────────────────────────────────────────

  async listL0(): Promise<L0Index[]> {
    const now = Date.now();
    const rows = this.stmts.listLive.all(now) as EntryRow[];
    return rows.map((row) => this.rowToL0(row));
  }

  async getL1(id: string): Promise<L1Preview> {
    const slug = this.stripPrefix(id);
    const row = this.stmts.findById.get(slug) as EntryRow | undefined;
    if (!row) throw new Error(`Memory entry not found: ${slug}`);
    const contentRow = this.stmts.getContent.get(slug) as { content: string } | undefined;
    const summary = this.truncateSummary(contentRow?.content ?? "");
    return {
      id,
      name: row.name,
      description: row.description,
      type: "memory" as const,
      tags: JSON.parse(row.tags) as string[],
      summary,
      constraints: `Priority: ${row.priority}${row.ttl_days != null ? ` | TTL: ${row.ttl_days} days` : " | permanent"}`,
    };
  }

  async getL2(id: string): Promise<L2Payload> {
    const slug = this.stripPrefix(id);
    const row = this.stmts.findById.get(slug) as EntryRow | undefined;
    if (!row) throw new Error(`Memory entry not found: ${slug}`);
    const contentRow = this.stmts.getContent.get(slug) as { content: string } | undefined;
    const fullContent = contentRow?.content ?? "";
    const summary = this.truncateSummary(fullContent);
    this.stmts.touchEntry.run(Date.now(), slug);
    return {
      id,
      name: row.name,
      description: row.description,
      type: "memory" as const,
      tags: JSON.parse(row.tags) as string[],
      summary,
      fullContent,
      constraints: `Priority: ${row.priority}${row.ttl_days != null ? ` | TTL: ${row.ttl_days} days` : " | permanent"}`,
    };
  }

  // ── MemoryProvider ─────────────────────────────────────────────────────────

  async list(): Promise<MemoryEntry[]> {
    const now = Date.now();
    const rows = this.stmts.listLive.all(now) as EntryRow[];
    return rows.map((row) => this.rowToEntry(row));
  }

  async getSummary(id: string): Promise<string> {
    const contentRow = this.stmts.getContent.get(id) as { content: string } | undefined;
    return this.truncateSummary(contentRow?.content ?? "");
  }

  async getContent(id: string): Promise<string> {
    const contentRow = this.stmts.getContent.get(id) as { content: string } | undefined;
    if (!contentRow) throw new Error(`Memory entry not found: ${id}`);
    this.stmts.touchEntry.run(Date.now(), id);
    return contentRow.content;
  }

  async write(
    meta: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "lastAccessedAt">,
    content: string,
  ): Promise<string> {
    const now = Date.now();
    const tagsJson = JSON.stringify(meta.tags);
    const ttlDays = meta.ttlDays ?? null;

    const upsert = this.db.transaction(() => {
      const existing = this.stmts.findByName.get(meta.name) as EntryRow | undefined;
      if (existing) {
        this.stmts.updateEntry.run(
          meta.description,
          meta.priority,
          tagsJson,
          ttlDays,
          now,
          now,
          existing.id,
        );
        this.stmts.updateContent.run(content, existing.id);
        return existing.id;
      }

      const id = crypto.randomUUID();
      this.stmts.insertEntry.run(
        id,
        meta.name,
        meta.description,
        meta.priority,
        tagsJson,
        now,
        now,
        now,
        ttlDays,
      );
      this.stmts.insertContent.run(id, content);
      return id;
    });

    return upsert() as string;
  }

  async delete(id: string): Promise<void> {
    const row = this.stmts.findById.get(id) as EntryRow | undefined;
    if (!row) throw new Error(`Memory entry not found: ${id}`);
    this.stmts.deleteEntry.run(id);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private initSchema(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS memory_entries (
        id               TEXT PRIMARY KEY,
        name             TEXT NOT NULL UNIQUE,
        description      TEXT NOT NULL DEFAULT '',
        priority         TEXT NOT NULL CHECK(priority IN ('P0','P1','P2')),
        tags             TEXT NOT NULL DEFAULT '[]',
        created_at       INTEGER NOT NULL,
        updated_at       INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        ttl_days         REAL
      );

      CREATE TABLE IF NOT EXISTS memory_content (
        id      TEXT PRIMARY KEY REFERENCES memory_entries(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT ''
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        name,
        description,
        tags,
        content='memory_entries',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memory_fts_insert
        AFTER INSERT ON memory_entries BEGIN
          INSERT INTO memory_fts(rowid, id, name, description, tags)
          VALUES (new.rowid, new.id, new.name, new.description, new.tags);
        END;

      CREATE TRIGGER IF NOT EXISTS memory_fts_update
        AFTER UPDATE ON memory_entries BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, id, name, description, tags)
          VALUES ('delete', old.rowid, old.id, old.name, old.description, old.tags);
          INSERT INTO memory_fts(rowid, id, name, description, tags)
          VALUES (new.rowid, new.id, new.name, new.description, new.tags);
        END;

      CREATE TRIGGER IF NOT EXISTS memory_fts_delete
        AFTER DELETE ON memory_entries BEGIN
          INSERT INTO memory_fts(memory_fts, rowid, id, name, description, tags)
          VALUES ('delete', old.rowid, old.id, old.name, old.description, old.tags);
        END;
    `;
    this.db.exec(sql);
  }

  private prepareStatements() {
    return {
      insertEntry: this.db.prepare(
        `INSERT INTO memory_entries (id, name, description, priority, tags, created_at, updated_at, last_accessed_at, ttl_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ),
      insertContent: this.db.prepare(
        `INSERT INTO memory_content (id, content) VALUES (?, ?)`,
      ),
      updateEntry: this.db.prepare(
        `UPDATE memory_entries
         SET description=?, priority=?, tags=?, ttl_days=?, updated_at=?, last_accessed_at=?
         WHERE id=?`,
      ),
      updateContent: this.db.prepare(
        `UPDATE memory_content SET content=? WHERE id=?`,
      ),
      findByName: this.db.prepare(
        `SELECT * FROM memory_entries WHERE name=?`,
      ),
      findById: this.db.prepare(
        `SELECT * FROM memory_entries WHERE id=?`,
      ),
      listLive: this.db.prepare(
        `SELECT * FROM memory_entries
         WHERE ttl_days IS NULL
            OR (CAST(created_at AS REAL) + ttl_days * 86400000.0) > ?
         ORDER BY created_at ASC`,
      ),
      getContent: this.db.prepare(
        `SELECT content FROM memory_content WHERE id=?`,
      ),
      deleteEntry: this.db.prepare(
        `DELETE FROM memory_entries WHERE id=?`,
      ),
      touchEntry: this.db.prepare(
        `UPDATE memory_entries SET last_accessed_at=? WHERE id=?`,
      ),
    };
  }

  private rowToL0(row: EntryRow): L0Index {
    return {
      id: `memory:${row.id}`,
      name: row.name,
      description: row.description,
      type: "memory" as const,
      tags: JSON.parse(row.tags) as string[],
      riskLevel: undefined,
    };
  }

  private rowToEntry(row: EntryRow): MemoryEntry {
    const priority = isValidPriority(row.priority) ? row.priority : "P2";
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      priority,
      tags: JSON.parse(row.tags) as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at,
      ttlDays: row.ttl_days ?? undefined,
    };
  }

  private truncateSummary(content: string): string {
    if (content.length > this.summaryMaxChars) {
      return content.slice(0, this.summaryMaxChars) + "\u2026";
    }
    return content;
  }

  private stripPrefix(id: string): string {
    return id.startsWith("memory:") ? id.slice("memory:".length) : id;
  }
}
