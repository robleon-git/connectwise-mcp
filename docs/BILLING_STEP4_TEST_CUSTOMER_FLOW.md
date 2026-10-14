# Step 4 — TEST-only customer billing flow

Status: repository implementation and isolated acceptance. Billing defaults OFF. No production deployment, production migration or LIVE Stripe enablement is included.

## Scope and ownership

The control API conditionally exposes `GET /connectwise/v1/billing/status`, `POST /connectwise/v1/billing/checkout`, `POST /connectwise/v1/billing/portal` and `POST /connectwise/v1/billing/webhook` only under explicit nonproduction TEST configuration. Production opt-in and LIVE credentials fail closed. With billing OFF, all four routes are absent and no billing worker is started.

Customer actions use the existing authenticated Microsoft portal session. The server resolves the active Monotorr user/account membership; browser-selected accounts, customers, subscriptions, prices and return URLs are rejected. POST requires the exact portal Origin, an empty JSON object and the existing session cookie. Requests are bounded to five billing actions per account per minute per process. This is a local abuse limit, not a distributed quota.

Checkout uses the configured TEST Price, quantity one, monthly USD $29, card payment, no promotion codes, no Stripe trial and no user-selectable return destination. Success and cancellation return to the fixed portal origin. A saved account/customer mapping and provider metadata must agree. An existing active/retryable subscription opens Customer Portal instead of creating another subscription.

A short database transaction reserves one pending Checkout per account. Its durable UUID is the Stripe idempotency key and pins all request parameters, including expiry. Known open sessions are reused. An uncertain provider outcome reuses the same reservation and idempotency key. Once an unknown outcome expires, the service returns `checkout_pending` rather than risking a second subscription. Such a reservation needs a separately reviewed provider reconciliation; there is no automatic bypass or deletion.

Completed sessions must match the saved session, reservation, account, customer and Price. A replay of an older completed Checkout cannot replace a newer subscription, even when that newer subscription has reached a terminal state. Checkout return URLs do not grant access.

## Durable webhook processing

Webhook ingress requires the raw JSON bytes and a valid Stripe signature before any database mutation. It is intentionally independent of portal sessions and browser Origin. Request bodies are limited to 256 KiB; no full payload, signature, secret or hosted-session URL is logged or persisted.

Only these six event classes enter reconciliation:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The existing Step 3 durable minimal receipt, leases, current-state reads and restricted writer remain authoritative. Association verifies the saved customer and Checkout before binding a subscription. Pending associations retry durably. A serial five-second worker drains a bounded batch and shuts down before the pool closes. Network calls happen outside SQL transactions; fencing protects final application.

Payment-proven active subscriptions activate only `web_paid`. Retryable payment failure preserves previously paid access. Terminal states cancel only `web_paid`. Local trial, comp and substack grants remain independent. Stripe `trialing`, `paused` and paused collection remain quarantined for policy review. MCP authorization uses the local multi-source entitlement evaluator and never calls Stripe.

## Additive schema

Migration `0006_test_billing_foundation` is unchanged:

`27b128d14c18f48668489ec6ce463a1b64dc0c946632abcde76c7e3481900ecc`

Migration `0007_test_billing_checkout` adds durable Checkout reservations, a unique pending reservation per account, a minimal Checkout reference on billing event receipts and the `checkout_pending` receipt category. Checksum:

`cf319314cc19a8daf7782bf23c7166160d7f7aa50eb0a60c86f58d32a8006e83`

`cw_control` may read/insert reservations and update only their session/status fields. It cannot delete reservations or replace their account/customer/Price. `cw_mcp` has no billing table access. No broad entitlement UPDATE/DELETE privilege or new entitlement writer is introduced. Migration 0007 must precede a future TEST control deployment; it was applied only to disposable local PostgreSQL during this implementation.

## TEST provider configuration

Canonical account: `acct_1TijenFjwlg4wm7X`.

Product: `prod_VR9VkK5ZSPbfZL`.

Monthly Price: `price_1UQHD0Fjwlg4wm7X949tR7hZ`.

TEST Customer Portal configuration: `bpc_1UQI07Fjwlg4wm7XEZRkYrzj`.

The separate Monotorr MCP configuration enables invoice history and payment method changes, permits cancellation at period end, disables subscription changes and public login, and returns to `https://portal.monotorr.com/`. It carries the `connectwise_mcp_v1` namespace. Existing Monotorr 365 settings are not repurposed.

Explicit local configuration uses `CW_BILLING_ENABLED=true`, `CW_BILLING_MODE=test`, the configured account/Product/Price/Portal IDs, and the existing portal customer-feature gate. Secrets may come from local `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, or the existing `CW_` aliases; conflicting alias values fail closed. A local `.env` is permitted only when ignored and uncommitted. The application does not introduce a new dotenv loader.

For eventual genuine local QA, run Stripe CLI using the explicitly approved TEST key supplied through its `STRIPE_API_KEY` environment variable, not an unrelated saved CLI login. Forward with `stripe listen` to the local `/connectwise/v1/billing/webhook` endpoint; use its temporary signing secret in the local application environment. Avoid shell tracing and redirecting listener output to persistent logs. Do not write either secret to documentation, evidence or shell history. Verify the canonical account before creating sessions.

No TEST credential is currently supplied. Genuine hosted Checkout and provider-generated, signed webhook QA are **pending**. Do not use `cw-mcp-kv` for local QA, and never use the customer credential vault. A future runtime secret-store decision is separate.

## Portal and evidence boundaries

A small Billing group sits within Account and follows the existing Fira typography and layout. Trial/eligible accounts show “Subscribe — $29/month”; mapped customers can “Manage billing”; retryable failures show restrained payment-attention text. Account access continues to be shown independently above Billing. Payment failure does not imply cancellation, and cancellation does not erase another valid entitlement or the saved ConnectWise connection. Customer responses omit Stripe IDs and entitlement source enums.

The earlier local header-only change to “Monotorr” is preserved separately. Step 4 adds only the Billing import/mount to `main.tsx`. A separate ignored Step 4 patch retains the committed header, so a future approved commit can leave the earlier header edit uncommitted.

Isolated acceptance uses real local PostgreSQL, HTTP routes and the official Stripe SDK to verify fixture signatures, with a simulated TEST provider. It covers lifecycle A–N, duplicate/out-of-order delivery, reservation reuse, cross-account denial and invalid-signature zero mutation. These results are not evidence of genuine hosted Checkout or Stripe-generated webhook delivery. Local browser evidence likewise uses synthetic API responses and is explicitly labeled.

The migration manifest is reachable from MCP readiness, so this change is classified **MCP-affecting**, despite Stripe and billing modules remaining outside all 39 MCP executable modules. A future release requires the existing same-SHA build and candidate acceptance path. Nothing is staged, committed, pushed or deployed by this implementation task.

## Local validation result

Focused billing/auth/linking/release validation: 427 tests across 13 files. Full suite: 1,086 tests across 44 files, including PostgreSQL 18 integration and the preserved historical test file. Backend/control, UI and portal builds, TypeScript, lint, ticket-card validation and diff checks passed. Production and full dependency audits report zero vulnerabilities. The tool surface remains 39 reads / zero writes with unchanged schemas. Local browser checks cover seven states at desktop/mobile widths, keyboard activation, pending-submit blocking and recoverable errors. Genuine Stripe-hosted QA remains pending, not passed.

## Checkout return refresh

The `billing=return` marker starts read-only confirmation checks; it is never evidence of payment or access. Billing must first be enabled by an authoritative status response. The portal reads billing status up to eight times, 2.5 seconds apart, with a hard 30-second deadline covering a stalled request. Confirmed active/payment-attention state stops the checks; other states retain truthful confirmation-pending copy. Timeout offers a manual Refresh that starts another bounded cycle. Ordinary visits retain the single-fetch behavior; billing-OFF responses hide the group.

Timers and fetches are canceled on effect cleanup, unmount, page hide and history navigation. Late responses cannot update state. A first authoritative return response and subsequent billing-state changes request a separate account/status refresh. Billing state never writes account access. The browser acceptance case deliberately returned active billing while account access stayed expired and verified the separation.

Seven focused return-refresh tests and five local browser scenarios cover delayed reconciliation, timeout/manual refresh, stalled requests, cleanup, query-marker safety, authoritative account refresh, and billing OFF. These are synthetic server-response tests; genuine hosted Stripe QA remains separately pending. The correction changes only Billing.tsx, account-refresh wiring in main.tsx, portal billing tests and this document. The complete Step 4 manifest remains 24 files. The Step 4-only main.tsx patch retains the committed header and excludes the prior unrelated header edit.
