import Stripe from "stripe";
import { BILLING_PRODUCT, BillingError, STRIPE_API_VERSION, type BillingConfig } from "./config.js";
import { providerId, type Receipt, type SubscriptionState } from "./model.js";
export interface BillingProvider {
  createCustomer(accountId: string): Promise<string>;
  verifyCustomer(customer: string, accountId: string): Promise<void>;
  subscription(id: string): Promise<SubscriptionState>;
  verifyWebhook(raw: Buffer, signature: string): Receipt;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ref = (value: unknown): string | null => typeof value === "string" ? value : value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : null;
function time(value: number): Date { const d = new Date(value * 1000); if (!Number.isSafeInteger(value) || value <= 0 || !Number.isFinite(d.getTime())) throw new BillingError("invalid_subscription"); return d; }
export function validatePrice(price: Stripe.Price, config: Pick<BillingConfig, "productId" | "priceId">) {
  if (price.livemode !== false || price.id !== config.priceId || ref(price.product) !== config.productId || price.currency !== "usd" || price.unit_amount !== 2900 || price.billing_scheme !== "per_unit" ||
      price.type !== "recurring" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.recurring.usage_type !== "licensed" || price.recurring.meter || price.recurring.trial_period_days || price.transform_quantity || price.tiers_mode || price.metadata.monotorr_product !== BILLING_PRODUCT) throw new BillingError("invalid_subscription");
}
export function normalizeSubscription(s: Stripe.Subscription, config: Pick<BillingConfig, "productId" | "priceId">): SubscriptionState {
  if (s.livemode !== false || s.items.has_more || s.items.data.length !== 1 || s.items.data[0].quantity !== 1 || s.collection_method !== "charge_automatically" || s.metadata.monotorr_product !== BILLING_PRODUCT || !uuid.test(s.metadata.monotorr_account_id ?? "")) throw new BillingError("invalid_subscription");
  const item = s.items.data[0]; validatePrice(item.price, config);
  const invoice = s.latest_invoice;
  const invoiceSubscription = typeof invoice === "object" && invoice !== null ? ref(invoice.parent?.subscription_details?.subscription) : null;
  const paidInvoice = typeof invoice === "object" && invoice !== null && invoice.livemode === false && invoice.status === "paid" && invoice.customer !== null && ref(invoice.customer) === ref(s.customer) && invoiceSubscription === s.id;
  const periodStart = time(item.current_period_start), periodEnd = time(item.current_period_end);
  const cancelAt = s.cancel_at !== null ? time(s.cancel_at) : s.cancel_at_period_end ? periodEnd : null;
  return { id: providerId(s.id, "sub"), customer: providerId(ref(s.customer), "cus"), accountId: s.metadata.monotorr_account_id, price: item.price.id, status: s.status, periodStart, periodEnd, cancelAt, paidInvoice, pausedCollection: s.pause_collection !== null };
}
/** Only constructed by an explicit test harness; never imported by the MCP graph or mounted in production. */
export class StripeBillingProvider implements BillingProvider {
  private readonly sdk: Stripe;
  constructor(private readonly config: BillingConfig, sdk?: Stripe) {
    if (config.mode !== "test" || !config.secretKey.startsWith("sk_test_")) throw new BillingError("invalid_configuration");
    this.sdk = sdk ?? new Stripe(config.secretKey, { apiVersion: STRIPE_API_VERSION, timeout: 5000, maxNetworkRetries: 0 });
  }
  private async verifyAccount() {
    try { const a = await this.sdk.accounts.retrieve(null); if (a.id !== this.config.stripeAccountId) throw new BillingError("invalid_mapping"); }
    catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  async createCustomer(accountId: string) {
    if (!uuid.test(accountId)) throw new BillingError("invalid_mapping");
    try { await this.verifyAccount(); const c = await this.sdk.customers.create({ metadata: { monotorr_account_id: accountId, monotorr_product: BILLING_PRODUCT } }, { idempotencyKey: `monotorr-mcp-test-customer-${accountId}` }); if (c.livemode !== false) throw new BillingError("invalid_mapping"); return providerId(c.id, "cus"); }
    catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  async verifyCustomer(customer: string, accountId: string) {
    try { await this.verifyAccount(); const c = await this.sdk.customers.retrieve(providerId(customer, "cus")); if (c.deleted || c.livemode !== false || c.metadata.monotorr_account_id !== accountId || c.metadata.monotorr_product !== BILLING_PRODUCT) throw new BillingError("invalid_mapping"); }
    catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  async subscription(id: string) {
    try { await this.verifyAccount(); return normalizeSubscription(await this.sdk.subscriptions.retrieve(providerId(id, "sub"), { expand: ["latest_invoice"] }), this.config); }
    catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  verifyWebhook(raw: Buffer, signature: string): Receipt {
    let e: Stripe.Event;
    if (!Buffer.isBuffer(raw) || raw.length === 0 || raw.length > 256 * 1024 || !signature || signature.length > 2048) throw new BillingError("invalid_signature");
    try { e = this.sdk.webhooks.constructEvent(raw, signature, this.config.webhookSecret, 300); }
    catch { throw new BillingError("invalid_signature"); }
    if (e.livemode !== false || e.api_version !== STRIPE_API_VERSION) throw new BillingError("invalid_signature");
    const o = e.data.object as unknown as { object?: string; id?: string; customer?: unknown; subscription?: unknown; parent?: { subscription_details?: { subscription?: unknown } }; metadata?: Record<string, string> };
    const customer = ref(o.customer), subscription = o.object === "subscription" ? o.id ?? null : o.object === "invoice" ? ref(o.parent?.subscription_details?.subscription) : ref(o.subscription);
    const hint = o.metadata?.monotorr_account_id;
    if (hint !== undefined && !uuid.test(hint)) throw new BillingError("invalid_mapping");
    if (customer !== null) providerId(customer, "cus"); if (subscription !== null) providerId(subscription, "sub");
    return { id: providerId(e.id, "evt"), type: e.type, created: time(e.created), customer, subscription, accountHint: typeof hint === "string" && uuid.test(hint) ? hint : null };
  }
}
