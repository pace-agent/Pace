// ---- Memory Types ----

/** Memory priority levels by lifetime */
export type MemoryPriority = "P0" | "P1" | "P2";

/** A single memory entry */
export interface MemoryEntry {
  id: string;
  name: string;
  description: string;
  priority: MemoryPriority;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  /** Time-to-live in days; undefined = permanent */
  ttlDays?: number;
}

/**
 * MemoryProvider — pluggable interface for memory storage backends.
 * Implements the three-layer protocol for memory resources.
 */
export interface MemoryProvider {
  /** List all memory entries as L0 index */
  list(): Promise<MemoryEntry[]>;

  /** Get summary (L1) for a memory entry */
  getSummary(id: string): Promise<string>;

  /** Get full content (L2) for a memory entry */
  getContent(id: string): Promise<string>;

  /** Write or update a memory entry */
  write(entry: Omit<MemoryEntry, "id" | "createdAt" | "updatedAt" | "lastAccessedAt">, content: string): Promise<string>;

  /** Delete a memory entry */
  delete(id: string): Promise<void>;
}
