import { BillingError, type BillingConfig } from "./config.js";
export const BILLING_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"] as const;
export interface Receipt { id: string; type: string; created: Date; customer: string | null; subscription: string | null; accountHint: string | null }
export interface BillingOwner { userId: string; accountId: string }
export interface Mapping { accountId: string; customer: string; subscription: string | null; price: string; paid: boolean; status: string | null }
export interface SubscriptionState { id: string; customer: string; accountId: string; price: string; status: string; periodStart: Date; periodEnd: Date; cancelAt: Date | null; paidInvoice: boolean; pausedCollection: boolean }
export interface Projection { status: string; action: "activate" | "preserve" | "cancel"; endsAt: Date | null; paid: boolean; periodStart: Date; periodEnd: Date }
export function projectSubscription(s: SubscriptionState, mapping: Mapping, config: Pick<BillingConfig, "priceId">): Projection {
  if (s.id !== mapping.subscription || s.customer !== mapping.customer || s.accountId !== mapping.accountId || s.price !== config.priceId || mapping.price !== config.priceId ||
      ![s.periodStart, s.periodEnd].every(d => d instanceof Date && Number.isFinite(d.getTime())) || s.periodEnd <= s.periodStart ||
      s.cancelAt !== null && (!(s.cancelAt instanceof Date) || !Number.isFinite(s.cancelAt.getTime()) || s.cancelAt <= s.periodStart)) throw new BillingError("invalid_subscription");
  if (s.pausedCollection || ["trialing", "paused"].includes(s.status)) throw new BillingError("policy_review_required"); // No Stripe trial or paused-collection policy in V1.
  const paid = mapping.paid || s.paidInvoice;
  let action: Projection["action"];
  switch (s.status) {
    case "active": action = paid ? "activate" : "preserve"; break;
    case "past_due": case "incomplete": action = "preserve"; break; // No first activation from failed payment; no invented grace timer.
    case "unpaid": case "canceled": case "incomplete_expired": action = "cancel"; break;
    default: throw new BillingError("policy_review_required");
  }
  return { status: s.status, action, endsAt: s.cancelAt, paid, periodStart: s.periodStart, periodEnd: s.periodEnd };
}
export function providerId(value: unknown, prefix: string): string {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)) throw new BillingError("invalid_mapping");
  return value;
}
