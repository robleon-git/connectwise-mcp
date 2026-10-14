export const STRIPE_API_VERSION = "2026-09-30.endive" as const;
export const BILLING_PRODUCT = "connectwise_mcp_v1";
export class BillingError extends Error {
  constructor(readonly category: "billing_disabled" | "invalid_configuration" | "invalid_signature" | "invalid_mapping" | "invalid_subscription" | "policy_review_required" | "billing_unavailable" | "lost_lease") { super(category); }
}
export interface BillingConfig { mode: "test"; stripeAccountId: string; productId: string; priceId: string; secretKey: string; webhookSecret: string }
/** Not called by control/MCP startup. An explicit nonproduction harness may opt into TEST mode only. */
export function billingConfig(env: NodeJS.ProcessEnv): BillingConfig | undefined {
  if (!env.CW_BILLING_ENABLED || env.CW_BILLING_ENABLED === "false") return undefined;
  if (env.CW_BILLING_ENABLED !== "true" || env.NODE_ENV === "production" || env.CW_BILLING_MODE !== "test" ||
      !/^acct_[A-Za-z0-9]+$/.test(env.CW_STRIPE_ACCOUNT_ID ?? "") || !/^prod_[A-Za-z0-9]+$/.test(env.CW_STRIPE_PRODUCT_ID ?? "") || !/^price_[A-Za-z0-9]+$/.test(env.CW_STRIPE_PRICE_ID ?? "") ||
      !/^sk_test_[A-Za-z0-9]+$/.test(env.CW_STRIPE_SECRET_KEY ?? "") || !/^whsec_[A-Za-z0-9]+$/.test(env.CW_STRIPE_WEBHOOK_SECRET ?? "")) throw new BillingError("invalid_configuration");
  return { mode: "test", stripeAccountId: env.CW_STRIPE_ACCOUNT_ID!, productId: env.CW_STRIPE_PRODUCT_ID!, priceId: env.CW_STRIPE_PRICE_ID!, secretKey: env.CW_STRIPE_SECRET_KEY!, webhookSecret: env.CW_STRIPE_WEBHOOK_SECRET! };
}
