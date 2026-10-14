export const STRIPE_API_VERSION = "2026-09-30.endive" as const;
export const BILLING_PRODUCT = "connectwise_mcp_v1";
export class BillingError extends Error {
  constructor(readonly category: "billing_disabled" | "invalid_configuration" | "invalid_signature" | "invalid_mapping" | "invalid_subscription" | "policy_review_required" | "billing_unavailable" | "lost_lease" | "checkout_pending" | "setup_required") { super(category); }
}
export interface BillingConfig { mode: "test"; stripeAccountId: string; productId: string; priceId: string; portalConfigurationId: string; secretKey: string; webhookSecret: string }
/** Control startup may explicitly opt into nonproduction TEST mode; never used by MCP startup. */
export function billingConfig(env: NodeJS.ProcessEnv): BillingConfig | undefined {
  if (!env.CW_BILLING_ENABLED || env.CW_BILLING_ENABLED === "false") return undefined;
  const secretKey=env.CW_STRIPE_SECRET_KEY??env.STRIPE_SECRET_KEY,webhookSecret=env.CW_STRIPE_WEBHOOK_SECRET??env.STRIPE_WEBHOOK_SECRET;
  if (env.CW_STRIPE_SECRET_KEY&&env.STRIPE_SECRET_KEY&&env.CW_STRIPE_SECRET_KEY!==env.STRIPE_SECRET_KEY || env.CW_STRIPE_WEBHOOK_SECRET&&env.STRIPE_WEBHOOK_SECRET&&env.CW_STRIPE_WEBHOOK_SECRET!==env.STRIPE_WEBHOOK_SECRET)throw new BillingError("invalid_configuration");
  if (env.CW_BILLING_ENABLED !== "true" || env.NODE_ENV === "production" || env.CW_BILLING_MODE !== "test" ||
      !/^acct_[A-Za-z0-9]+$/.test(env.CW_STRIPE_ACCOUNT_ID ?? "") || !/^prod_[A-Za-z0-9]+$/.test(env.CW_STRIPE_PRODUCT_ID ?? "") || !/^price_[A-Za-z0-9]+$/.test(env.CW_STRIPE_PRICE_ID ?? "") ||
      !/^bpc_[A-Za-z0-9]+$/.test(env.CW_STRIPE_PORTAL_CONFIGURATION_ID ?? "") || !/^sk_test_[A-Za-z0-9]+$/.test(secretKey ?? "") || !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret ?? "")) throw new BillingError("invalid_configuration");
  return { mode: "test", stripeAccountId: env.CW_STRIPE_ACCOUNT_ID!, productId: env.CW_STRIPE_PRODUCT_ID!, priceId: env.CW_STRIPE_PRICE_ID!, portalConfigurationId: env.CW_STRIPE_PORTAL_CONFIGURATION_ID!, secretKey: secretKey!, webhookSecret: webhookSecret! };
}
