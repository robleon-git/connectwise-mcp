import { BillingError, type BillingConfig } from "./config.js";
import { projectSubscription, billingPresentation, type BillingOwner } from "./model.js";
import { stripeDestination } from "./stripe.js";
import type { BillingProvider } from "./stripe.js";
import type { BillingStore } from "./store.js";
/** TEST-only customer billing and durable reconciliation; never used by MCP execution. */
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
    const config = this.enabled(); if(this.provider.checkout){try{if(!await this.associate(id))return {applied:false};}catch(e){const category=e instanceof BillingError?e.category:"billing_unavailable";await this.store.deferAssociation(id,["invalid_mapping","invalid_subscription","policy_review_required"].includes(category));throw new BillingError(category);}} const claim = await this.store.claim(id); if (!claim) return { applied: false };
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

  async status(owner:BillingOwner,trial=false) {this.enabled();return billingPresentation(await this.store.owned(owner),trial);}
  async portal(owner:BillingOwner) {this.enabled();const m=await this.store.owned(owner);if(!m)throw new BillingError("setup_required");await this.provider.verifyCustomer(m.customer,owner.accountId);if(!this.provider.portal)throw new BillingError("invalid_configuration");return {url:stripeDestination(await this.provider.portal(m.customer),"portal")};}
  async checkout(owner:BillingOwner):Promise<{url:string}> {
    this.enabled();const m=await this.customer(owner);if(!this.provider.checkout || !this.provider.createCheckout)throw new BillingError("invalid_configuration");
    if(m.subscription){const current=await this.provider.subscription(m.subscription);if(current.customer!==m.customer||current.accountId!==owner.accountId)throw new BillingError("invalid_mapping");if(!["canceled","unpaid","incomplete_expired"].includes(current.status)||!["canceled","unpaid","incomplete_expired"].includes(m.status??""))return this.portal(owner);}
    let r=await this.store.reserveCheckout(owner);
    if(r.session){const s=await this.provider.checkout(r.session);await this.store.saveCheckout(r,s);if(s.status==='complete'){await this.store.confirmCheckout(r,s);return this.portal(owner);}if(s.status==='expired')r=await this.store.reserveCheckout(owner);else if(s.url){await this.store.owned(owner);return {url:stripeDestination(s.url,"checkout")};}}
    if(r.expiresAt.getTime()<=Date.now())throw new BillingError("checkout_pending"); // Unknown expired API outcome cannot start a second checkout.
    try{const s=await this.provider.createCheckout(r);await this.store.owned(owner);await this.store.saveCheckout(r,s);if(s.status==='complete'){await this.store.confirmCheckout({...r,session:s.id},s);return this.portal(owner);}if(s.status!=='open'||!s.url)throw new BillingError("checkout_pending");return {url:stripeDestination(s.url,"checkout")};}
    catch(e){await this.store.uncertainCheckout(r.id);if(e instanceof BillingError)throw e;throw new BillingError("billing_unavailable");}
  }
  private async associate(id:string):Promise<boolean> {
    const a=await this.store.association(id);if(!a)return true;
    if(a.receipt.accountHint!==null&&a.receipt.accountHint!==a.mapping.accountId){await this.store.deferAssociation(id,true);return false;}
    const r=await this.store.checkoutReservation(a.mapping.accountId,a.receipt.checkoutSession??undefined);
    if(a.receipt.checkoutSession && !r){await this.store.deferAssociation(id,true);return false;}
    if(a.mapping.subscription===a.receipt.subscription && !a.receipt.checkoutSession)return true;
    if(!r?.session){await this.store.deferAssociation(id,!!a.mapping.subscription);return false;}
    const s=await this.provider.checkout!(r.session);
    if(s.status!=='complete'){await this.store.deferAssociation(id);return false;}
    if(s.subscription!==a.receipt.subscription){await this.store.deferAssociation(id,true);return false;}
    const current=await this.provider.subscription(s.subscription!);projectSubscription(current,{...a.mapping,subscription:s.subscription},this.enabled());
    await this.provider.verifyCustomer(a.mapping.customer,a.mapping.accountId);await this.store.confirmCheckout(r,s);return true;
  }
  async drain(limit = 25) { this.enabled(); const ids = await this.store.pending(limit); for (const id of ids) await this.process(id); return { examined: ids.length }; }
}
