import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceRegistry } from "./ResourceRegistry.js";
import type { ResourceProvider, L0Index, L1Preview, L2Payload } from "../types/resource.js";

function makeProvider(type: ResourceProvider["type"], ids: string[]): ResourceProvider {
  const l0: L0Index[] = ids.map((id) => ({
    id,
    name: id,
    description: `Description for ${id}`,
    type,
    tags: [type],
  }));
  return {
    type,
    listL0: vi.fn().mockResolvedValue(l0),
    getL1: vi.fn().mockImplementation(
      async (id: string): Promise<L1Preview> => ({
        ...l0.find((r) => r.id === id)!,
        summary: `Summary for ${id}`,
      }),
    ),
    getL2: vi.fn().mockImplementation(
      async (id: string): Promise<L2Payload> => ({
        ...l0.find((r) => r.id === id)!,
        summary: `Summary for ${id}`,
        fullContent: `Full content for ${id}`,
      }),
    ),
  };
}

describe("ResourceRegistry", () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  it("aggregates L0 from multiple providers", async () => {
    const toolProvider = makeProvider("tool", ["tool:web_search", "tool:file_read"]);
    const memoryProvider = makeProvider("memory", ["memory:user_prefs"]);
    registry.register(toolProvider);
    registry.register(memoryProvider);

    const all = await registry.listAllL0();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.id)).toContain("tool:web_search");
    expect(all.map((r) => r.id)).toContain("memory:user_prefs");
  });

  it("caches L0 results and does not re-call providers", async () => {
    const provider = makeProvider("tool", ["tool:web_search"]);
    registry.register(provider);

    await registry.listAllL0();
    await registry.listAllL0();

    expect(provider.listL0).toHaveBeenCalledTimes(1);
  });

  it("invalidates cache when new provider is registered", async () => {
    const p1 = makeProvider("tool", ["tool:web_search"]);
    registry.register(p1);
    await registry.listAllL0();

    const p2 = makeProvider("memory", ["memory:user_prefs"]);
    registry.register(p2);
    const all = await registry.listAllL0();

    expect(all).toHaveLength(2);
    expect(p1.listL0).toHaveBeenCalledTimes(2);
  });

  it("routes getL1 by id prefix", async () => {
    const toolProvider = makeProvider("tool", ["tool:web_search"]);
    const memProvider = makeProvider("memory", ["memory:user_prefs"]);
    registry.register(toolProvider);
    registry.register(memProvider);

    await registry.getL1("tool:web_search");
    expect(toolProvider.getL1).toHaveBeenCalledWith("tool:web_search");
    expect(memProvider.getL1).not.toHaveBeenCalled();
  });

  it("routes getL2 by id prefix", async () => {
    const toolProvider = makeProvider("tool", ["tool:web_search"]);
    registry.register(toolProvider);

    await registry.getL2("tool:web_search");
    expect(toolProvider.getL2).toHaveBeenCalledWith("tool:web_search");
  });

  it("throws if no provider found for resource type", async () => {
    await expect(registry.getL1("tool:web_search")).rejects.toThrow(
      "No provider registered",
    );
  });
});
