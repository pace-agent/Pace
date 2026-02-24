import type { L0Index, L1Preview, L2Payload, ResourceProvider, ResourceType } from "../types/resource.js";

export class ResourceRegistry {
  private providers = new Map<ResourceType, ResourceProvider>();
  private l0Cache: L0Index[] | null = null;

  register(provider: ResourceProvider): void {
    this.providers.set(provider.type, provider);
    this.l0Cache = null;
  }

  async listAllL0(): Promise<L0Index[]> {
    if (this.l0Cache) return this.l0Cache;
    const results = await Promise.all(
      Array.from(this.providers.values()).map((p) => p.listL0()),
    );
    this.l0Cache = results.flat();
    return this.l0Cache;
  }

  async getL1(resourceId: string): Promise<L1Preview> {
    return this.resolveProvider(resourceId).getL1(resourceId);
  }

  async getL2(resourceId: string): Promise<L2Payload> {
    return this.resolveProvider(resourceId).getL2(resourceId);
  }

  private resolveProvider(resourceId: string): ResourceProvider {
    const type = resourceId.split(":")[0] as ResourceType;
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`No provider registered for resource type: ${type}`);
    }
    return provider;
  }
}
