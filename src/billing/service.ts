import { BillingError, type BillingConfig } from "./config.js";
import { projectSubscription, type BillingOwner } from "./model.js";
import type { BillingProvider } from "./stripe.js";
import type { BillingStore } from "./store.js";
/** Explicit test-only harness API. No customer Checkout/Portal/webhook routes, timers or startup wiring. */
export class BillingService {
  constructor(private readonly config: BillingConfig | undefined, private readonly store: BillingStore, private readonly provider: BillingProvider) {}
  private enabled(): BillingConfig { if (!this.config) throw new BillingError("billing_disabled"); if (this.config.mode !== "test") throw new BillingError("invalid_configuration"); return this.config; }
  async customer(owner: BillingOwner) {
    const config = this.enabled(); const existing = await this.store.owned(owner);
    if (existing) { if (existing.price !== config.priceId) throw new BillingError("invalid_mapping"); await this.provider.verifyCustomer(existing.customer,owner.accountId); return existing; }
    const id = await this.provider.createCustomer(owner.accountId); await this.provider.verifyCustomer(id,owner.accountId); return this.store.mapCustomer(owner,id,config.priceId);
  }
  async registerSubscription(owner: BillingOwner, subscription: string) {
    const config = this.enabled(); const m = await this.store.owned(owner); if (!m) throw new BillingError("invalid_mapping");
    await this.provider.verifyCustomer(m.customer,owner.accountId);
    const s = await this.provider.subscription(subscription); projectSubscription(s,{...m,subscription},config);
    await this.store.bindSubscription(owner,m.customer,subscription);
  }
  async receiveWebhook(raw: Buffer, signature: string) {
    this.enabled(); const receipt = this.provider.verifyWebhook(raw,signature); return this.store.receive(receipt); // Durable receipt, never grant from return URL/payload.
  }
  async process(id: string) {
    const config = this.enabled(); const claim = await this.store.claim(id); if (!claim) return { applied: false };
    try {
      await this.provider.verifyCustomer(claim.mapping.customer,claim.mapping.accountId);
      // Network occurs OUTSIDE SQL transaction; lease fencing prevents an older request from applying after a newer worker.
      const current = await this.provider.subscription(claim.mapping.subscription!);
      await this.store.finish(claim,projectSubscription(current,claim.mapping,config)); return { applied: true };
    } catch (e) {
      const category = e instanceof BillingError ? e.category : "billing_unavailable";
      await this.store.fail(claim,category); throw new BillingError(category);
    }
  }
  async drain(limit = 25) { this.enabled(); const ids = await this.store.pending(limit); for (const id of ids) await this.process(id); return { examined: ids.length }; }
}
