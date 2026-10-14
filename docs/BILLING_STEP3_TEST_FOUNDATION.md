# Billing Step 3 — disabled TEST foundation

Implementation for review only. No commit, production migration, deployment, customer billing UI/routes, or commercial enablement. The six pre-existing local documentation/header/continuity files remain separate. Production remains on the accepted multi-source reader from 00663eb9.

## Test catalog and configuration

Use only Leon Labs LLC sandbox `acct_1TijenFjwlg4wm7X`; do not use the other Leon Labs account. The new MCP objects are partitioned from the existing 365 catalog with `monotorr_product=connectwise_mcp_v1` metadata and a dedicated lookup key.

- Product: `prod_VR9VkK5ZSPbfZL` — Monotorr.
- Price: `price_1UQHD0Fjwlg4wm7X949tR7hZ` — USD 2900, monthly interval/count 1, per-unit licensed usage, subscription quantity 1; no tiers, meter, annual counterpart, or Stripe trial.
- Stripe Node SDK is pinned to 23.0.0 and its stable API `2026-09-30.endive`. Event destinations in a future test harness must match that version; unexpected event versions fail closed.

`CW_BILLING_ENABLED` defaults OFF. An absent/false flag returns no configuration. Explicit opt-in requires nonproduction `NODE_ENV`, `CW_BILLING_MODE=test`, `CW_STRIPE_ACCOUNT_ID`, `CW_STRIPE_PRODUCT_ID`, `CW_STRIPE_PRICE_ID`, and test key/signing-secret values supplied in memory through approved secret handling. Product/Price IDs never appear in business logic. Live keys and production opt-in are rejected. The adapter verifies its authenticated Stripe account before customer/subscription API operations and checks returned objects are TEST mode.

Nothing imports the billing service from control or MCP startup. There are no Checkout/Customer Portal/webhook customer routes, Stripe secret delivery, schedulers, or workers enabled by this change. Internal `BillingService` methods support an explicitly constructed test harness; Checkout/Portal session creation and their authenticated routes remain later implementation work.

## Additive persistence and writer

Migration `0006_test_billing_foundation` adds only `account_billing`, `billing_events`, their constraints/indexes, and `apply_test_stripe_projection`. Apply it only to disposable PostgreSQL during this task. The migration creates no database role and changes no prior migration, customer row, existing entitlement, identity binding, or connection.

`account_billing` has one account/FK, one unique customer and current subscription, configured Price, TEST-only mode, verified commercial status/period/cancellation metadata, paid-confirmation state, and version/lease fencing. `billing_events` stores only IDs/type/time/mapping references and receipt/lease/retry/category metadata. It stores no raw event, signature, email, card, invoice/payment payload, or secrets. Source data and other entitlement grants are independent.

The schema owner `cw_migrator` owns the SECURITY DEFINER writer with fixed `search_path=pg_catalog`, qualified objects, no dynamic SQL, and no selectable source. PUBLIC and `cw_mcp` EXECUTE are revoked; only existing `cw_control` may execute it from the internal billing service. No blanket entitlement UPDATE/DELETE rights are added. Existing account-onboarding INSERT rights are preserved. The function verifies customer/subscription/Price, unexpired lease/version, action/status consistency, payment confirmation and finite periods, then activates/reactivates or cancels only the single `web_paid` row. It never deletes history or changes trial/comp/substack, credentials, connections or bindings.

`cw_control` receives bounded billing-table SELECT/INSERT and explicit UPDATE columns, with no DELETE or provider-customer/Price replacement grant. `cw_mcp` receives no billing table or writer privileges. A future separate billing login/secret or role bootstrap requires its own delivery review; none is provisioned here.

## Explicit lifecycle policy

| Current authoritative Stripe state | web_paid action |
| --- | --- |
| active plus matching paid invoice or prior confirmed activation | Activate/reactivate; normal renewal open-ended, verified cancellation finite. |
| active without first-payment proof | Preserve; no first grant. |
| past_due | Preserve existing grant while provider dunning continues; no first grant and no local grace-period timer. |
| incomplete | Preserve; no first grant. |
| unpaid, canceled, incomplete_expired | Cancel only web_paid; retain history and other valid sources. |
| trialing, paused, paused collection, unknown state | Quarantine for policy review; no silent grant/revocation. |

Stripe trials are not enabled in this V1 model: Monotorr's existing independent 720-hour no-card trial remains valid until its original expiry. This is why `trialing` is not an applicable automatic paid grant in this foundation. Dunning duration, tax and paused-collection behavior remain commercial launch decisions; no account-wide settings were changed.

The adapter normalizes the sole subscription item's period fields and exact configured monthly Price/quantity, verifies subscription/customer/account metadata, and verifies the latest paid invoice belongs to that customer/subscription. [Stripe subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview) and [subscription invoices](https://docs.stripe.com/billing/invoices/subscription) describe the underlying provider states. Monotorr's access policy remains explicit and independent.

## Signed receipt and processing foundation

Allowlist: checkout.session.completed; customer.subscription.created/updated/deleted; invoice.paid/payment_failed. Unsupported valid events are durably ignored. The official SDK verifies bounded, untouched raw bytes with a 300-second signature tolerance and expected API/TEST mode before receipt insertion. Invalid signatures cause no SQL or grant. No payload is logged or stored.

An existing authenticated owner establishes a customer mapping without email lookup; it is rechecked when persisted. A known, provider-verified subscription must be explicitly registered to that owned customer before its events can grant access. Unknown/mismatched references or account hints quarantine; webhook metadata cannot claim an account or replace the current subscription. An old subscription's event cannot cancel a newer mapping.

Receipt insertion is idempotent; unfinished duplicate work remains durable/retryable. Processing leases the receipt and account in a short SQL transaction, retrieves the current authoritative customer/subscription outside that transaction, and atomically applies the projection and processed receipt only with a valid lease/version. It does not replay stale event status or rely on timestamp ordering. Concurrent/lost/expired leases cannot commit older projections. Provider failures retain grants and record a sanitized retry category. Database failure rolls back the grant, projection and receipt together. The bounded manual drain can resume expired work; a future operational scheduler/reconciliation cadence and retention policy need review before enabling ingestion.

MCP authorization and ConnectWise execution import no Stripe or billing service, make no Stripe calls, and retain principal → account → local entitlement → connection → credential → ConnectWise ordering. Denial before credential/ConnectWise remains covered by the accepted reader/security tests. Neither the existing trial nor comp/substack is revoked by paid cancellation.

## Review and delivery boundaries

The new dependency/package inputs and migration manifest make this **MCP-affecting** under the existing fail-closed release classifier. No guard or same-SHA provenance exception is introduced. Tools/schemas remain 39 reads/0 writes. Subsequent delivery requires reviewed commit/push, exact-SHA build, migration 0006 through the private path, renewed candidate acceptance, compatible control/MCP release evidence and separate promotion/cutover approval. No paid-only customer may be introduced before a compatible multi-source rollback artifact is retained.

Validation evidence is kept as sanitized ignored `.delivery/billing-step3` artifacts. Test credentials in unit/disposable-database fixtures are synthetic, not Stripe keys. No LIVE Stripe action, Azure/RBAC/secret write, production database mutation, or app deployment is included.
