import { DurableObject } from "cloudflare:workers";

export class UnpairedUsersDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    // Required, as we're extending the base class.
    super(ctx, env)
  }

  async add(username: string) {
    await this.ctx.storage.put(username, {
      timestamp: Date.now(),
    });
  }

  async remove(username: string) {
    await this.ctx.storage.delete(username);
  }

  async list(): Promise<string[]> {
    const entries = await this.ctx.storage.list();
    return Array.from(entries.keys());
  }
}
