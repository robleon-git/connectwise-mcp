import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { BILLING_PRODUCT, type BillingConfig } from '../billing/config.js';
import { StripeBillingProvider } from '../billing/stripe.js';
import type { CheckoutReservation } from '../billing/model.js';

const config: BillingConfig = { mode: 'test', stripeAccountId: 'acct_fixture', productId: 'prod_fixture', priceId: 'price_fixture', portalConfigurationId: 'bpc_fixture', secretKey: 'sk_test_syntheticFixtureOnly', webhookSecret: 'whsec_syntheticFixtureOnly' };
const reservation: CheckoutReservation = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', customer: 'cus_fixture', price: config.priceId, session: null, status: 'reserved', expiresAt: new Date('2030-01-01T01:00:00Z') };
function fixture() {
  const price = { id: config.priceId, product: config.productId, active: true, livemode: false, currency: 'usd', unit_amount: 2900, billing_scheme: 'per_unit', type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', meter: null, trial_period_days: null }, transform_quantity: null, tiers_mode: null, metadata: { monotorr_product: BILLING_PRODUCT } };
  const session = { id: 'cs_test_fixture', customer: reservation.customer, subscription: null, mode: 'subscription', status: 'open', livemode: false, client_reference_id: reservation.accountId, expires_at: reservation.expiresAt.getTime() / 1000, url: 'https://checkout.stripe.com/c/pay/cs_test_fixture', metadata: { monotorr_product: BILLING_PRODUCT, monotorr_account_id: reservation.accountId, monotorr_checkout_id: reservation.id } };
  const portalConfig = { active: true, livemode: false, metadata: { monotorr_product: BILLING_PRODUCT }, features: { subscription_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end' } }, login_page: { enabled: false } };
  const sdk = { accounts: { retrieve: vi.fn(async () => ({ id: config.stripeAccountId })) }, prices: { retrieve: vi.fn(async () => price) }, products: { retrieve: vi.fn(async () => ({ id: config.productId, active: true, livemode: false, metadata: { monotorr_product: BILLING_PRODUCT } })) }, checkout: { sessions: { create: vi.fn(async () => session), retrieve: vi.fn(async () => session), listLineItems: vi.fn(async () => ({ has_more: false, data: [{ quantity: 1, price }] })) } }, billingPortal: { configurations: { retrieve: vi.fn(async () => portalConfig) }, sessions: { create: vi.fn(async () => ({ customer: reservation.customer, configuration: config.portalConfigurationId, livemode: false, return_url: 'https://portal.monotorr.com/', url: 'https://billing.stripe.com/p/session/test_fixture' })) } } };
  return { sdk, price, session, portalConfig, provider: new StripeBillingProvider(config, sdk as unknown as Stripe) };
}
describe('TEST-only hosted billing provider contract', () => {
  it('pins one monthly card subscription, fixed destinations and reservation idempotency without a Stripe trial', async () => {
    const f = fixture(); expect(await f.provider.createCheckout(reservation)).toMatchObject({ id: 'cs_test_fixture', accountId: reservation.accountId, reservationId: reservation.id });
    const [params, options] = f.sdk.checkout.sessions.create.mock.calls[0] as unknown as [Record<string, unknown>, { idempotencyKey: string }];
    expect(params).toMatchObject({ mode: 'subscription', customer: reservation.customer, line_items: [{ price: config.priceId, quantity: 1 }], allowed_payment_method_types: ['card'], allow_promotion_codes: false, client_reference_id: reservation.accountId, success_url: 'https://portal.monotorr.com/?billing=return', cancel_url: 'https://portal.monotorr.com/?billing=canceled', expires_at: reservation.expiresAt.getTime() / 1000 });
    expect(params.subscription_data).toEqual({ metadata: { monotorr_product: BILLING_PRODUCT, monotorr_account_id: reservation.accountId } }); expect(options.idempotencyKey).toBe(`monotorr-mcp-test-checkout-${reservation.id}`);
  });
  it('rejects the wrong Stripe account before creating any session', async () => {
    const f = fixture(); f.sdk.accounts.retrieve.mockResolvedValueOnce({ id: 'acct_unrelated' }); await expect(f.provider.createCheckout(reservation)).rejects.toThrow('invalid_mapping'); expect(f.sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it.each([{ livemode: true }, { unit_amount: 2901 }, { recurring: { interval: 'year' } }, { active: false }])('rejects incompatible catalog %j before session creation', async change => {
    const f = fixture(); Object.assign(f.price, change); await expect(f.provider.createCheckout(reservation)).rejects.toThrow('invalid_subscription'); expect(f.sdk.checkout.sessions.create).not.toHaveBeenCalled();
  });
  it.each([{ livemode: true }, { mode: 'payment' }, { client_reference_id: 'not-an-account' }, { url: 'https://evil.example/checkout' }])('rejects an unsafe retrieved session %j', async change => {
    const f = fixture(); Object.assign(f.session, change); await expect(f.provider.checkout('cs_test_fixture')).rejects.toThrow();
  });
  it('rejects a multi-item or non-unit checkout', async () => {
    const f = fixture(); f.sdk.checkout.sessions.listLineItems.mockResolvedValueOnce({ has_more: false, data: [{ quantity: 2, price: f.price }] }); await expect(f.provider.checkout('cs_test_fixture')).rejects.toThrow('invalid_subscription');
  });
  it('pins Portal to the mapped customer, approved configuration and fixed return URL', async () => {
    const f = fixture(); expect(await f.provider.portal(reservation.customer)).toBe('https://billing.stripe.com/p/session/test_fixture'); expect(f.sdk.billingPortal.sessions.create.mock.calls[0]).toEqual([{ customer: reservation.customer, configuration: config.portalConfigurationId, return_url: 'https://portal.monotorr.com/' }]);
  });
  it('rejects LIVE or subscription-changing Portal configuration before creating a session', async () => {
    for (const change of [{ livemode: true }, { features: { subscription_update: { enabled: true }, subscription_cancel: { enabled: true, mode: 'at_period_end' } } }]) {
      const f = fixture(); Object.assign(f.portalConfig, change); await expect(f.provider.portal(reservation.customer)).rejects.toThrow('invalid_configuration'); expect(f.sdk.billingPortal.sessions.create).not.toHaveBeenCalled();
    }
  });
  it('sanitizes provider failures without returning provider errors', async () => {
    const f = fixture(); f.sdk.prices.retrieve.mockRejectedValueOnce(Error('sensitive-provider-canary')); await expect(f.provider.createCheckout(reservation)).rejects.toThrow(/^billing_unavailable$/);
  });
});
