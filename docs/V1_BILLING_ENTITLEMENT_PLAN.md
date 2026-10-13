# V1 Billing + Entitlement plan

Status: authoritative launch architecture plan; implementation and live operations require separate approval. Owner decisions below are settled. Created October 13, 2026, against source `a809e29c937865d177d2274f8a5732f8261ba84d` on `phase1-hardening`.

**Stripe determines commercial subscription state. Monotorr entitlement remains the product authorization source of truth. MCP execution never requires a live Stripe API call.**

## 1. Approved commercial scope

Stripe Checkout, Stripe Billing subscriptions, Stripe Customer Portal, and signed webhooks provide one account-level subscription: **Monotorr, $29 USD/month**, quantity one. V1 allows one ConnectWise connection per account. Preserve the existing automatic 30-day trial with no card required. No annual plan, seats, metering, multiple tiers, custom invoices, or Monotorr card-entry form. Creating this plan provisions no Stripe resources.

Durable product model: Monotorr account → entitlement → ConnectWise connection → MCP access. Microsoft business sign-in resolves the portal user/account; verified Descope issuer/sub resolves the MCP user/account through explicit bindings. Billing belongs to the internal account, independently of both authentication providers. Replacing an MCP identity cannot change billing, account data, or entitlement ownership.

## 2. Current implementation audit and required differences

| Area | Observed source | Current behavior / implementation requirement |
| --- | --- | --- |
| Entitlement schema | `database/migrations/0002_customer_foundation.sql` | Permits `trial`, `web_paid`, `substack`, `comp`; statuses `active`, `expired`, `canceled`, `suspended`; `starts_at` required, `ends_at` nullable; only one trial per account enforced. No billing tables. |
| Trial creation | `src/control-plane/auth/store.ts`, `CustomerStore.login` | First successfully resolved Microsoft tenant/object identity creates user/account/owner membership and trial in one transaction; `now()` to `now()+interval '720 hours'`. Repeat sign-in retains the same trial. No card collection. |
| Portal access | Same file, `evaluateTrial` / `status` | Trial-only query, exactly one row required, active with start ≤ evaluation time < end. Date expiry is evaluated at read time; no expiry job is necessary. Null end is not handled as indefinite access by this evaluator. |
| Connection setup | `src/connections/store.ts`, `eligible` | Ownership and active user/account plus a valid **trial** required before validation or vault writes. Connection metadata status is independently readable for the owned account. |
| MCP execution | `src/auth/customer-access.ts`, `AccountAccessStore.resolve` | Explicit principal binding, active owner/account, then exactly one valid **trial**, then connection metadata; `createCustomerConfigProvider` fetches credentials only after this gate. No cached account authorization. |
| AI association | `src/control-plane/auth/mcp-link-store.ts` | Existing authenticated owner/session and unique issuer/sub; no email mapping or billing ownership. Keep this behavior. |
| Database privileges | Migrations 0002/0004 | `cw_control` can SELECT/INSERT entitlements, but cannot UPDATE/DELETE them. `cw_mcp` has column-scoped entitlement SELECT only. |
| Delivery conventions | `src/database/migrationManifest.ts`, `migrationRunner.ts`, `deployment/azure/config.json`, delivery runbook | Additive, checksummed migrations through reviewed private delivery; managed identity/Key Vault secrets; explicit runtime grants and separate release approval. |

**Conflict to resolve during implementation:** schema support is not operational multi-source support. Adding a `web_paid` row alone will not grant paid access today. `substack` and `comp` are representable but not accepted by current trial-only execution/setup/portal gates. They have no automated provider ingestion in the audited code. This plan requires a shared multi-source evaluator across those gates, not a second authorization service. Existing trial behavior must continue to pass regression tests.

No code, schema, role, entitlement, or deployed application is changed by this audit. Future grants must be source-bounded; a blanket entitlement UPDATE/DELETE grant is not the preferred solution.

## 3. Effective entitlement and source independence

At database evaluation time T, a grant is valid when its source is recognized, status is `active`, starts_at ≤ T, and ends_at is null or T < ends_at. Validate timestamps before evaluating; malformed grants cannot authorize. Active user/account and owner membership remain independent requirements. The effective account authorization is **ANY valid grant** across trial, web_paid, substack, comp. A suspended/canceled Stripe grant cannot override another valid grant. Expiration is exclusive at the end timestamp. Trial always has its original finite end; future manual comp/substack grants may be indefinite.

Billing manages **only web_paid**. It cannot delete, suspend, shorten, or replace comp/substack/trial grants. Future admin operations manage Monotorr grants rather than rewriting Stripe history; full admin UI and Substack integration are not in scope.

For presentation only, prefer web-paid status when present, then show a valid trial, then generic access-active for comp/substack. This display ordering is not authorization precedence. A payment warning may coexist with access supplied by another source. Do not expose raw source enums or imply Stripe owns all access.

Share the exact validity predicate between portal status, setup reservation, and MCP access. Read grants at the existing account boundary on each request; do not consult Stripe or introduce indefinite process caches. If database authorization cannot be evaluated, fail safely without credentials/CW calls. Already-running reads are not retroactively canceled; the next gated request observes committed entitlement changes.

## 4. Trial and conversion

The trial begins at first account creation, measured as 720 hours / 30 elapsed days, not a calendar month or a new trial per login. Preserve start/end/history and the one-trial constraint. Unpaid expiration removes trial authorization; another valid source can still grant access. Portal authentication and billing recovery remain available when product access is inactive.

Proposed conversion rule: subscribing activates web_paid immediately after verified payment/subscription confirmation; the original trial remains independently valid until its original expiration and is never extended or recreated. Portal prefers paid presentation, preserving historical trial timestamps. If paid access ends before the original trial ends, the remaining valid trial still grants access under the ANY rule. This makes the paid+trial state explicit rather than overwriting a source. Phase A must confirm this conversion detail with the owner before implementation if trial retirement instead is desired.

Do not create a second Stripe trial or defer collection by default: the existing Monotorr trial already provides the approved no-card evaluation period. No Stripe resource/configuration decision is executed by this document.

## 5. Stripe lifecycle projection

These are **Monotorr policy decisions**, not a direct cast of a Stripe status into product access. Pin the Stripe SDK/API and webhook version before implementation. Period fields must be normalized from the sole configured subscription item as required by that API version; never assume a top-level field exists.

| Verified provider/business state | Monotorr web_paid effect |
| --- | --- |
| Checkout pending, abandoned, or initial `incomplete` | No new paid grant; existing other grants unchanged. Return URL is not payment evidence. |
| Eligible subscription `active` with first payment confirmed | Create/reactivate the account's web_paid grant. Record paid period and renewal state. Do not provision merely because subscription.created or checkout.completed arrived. |
| Renewal successfully confirmed | Keep grant active; advance period metadata without resetting trial or connection. |
| Previously provisioned subscription `past_due` / retryable collection issue | Keep existing web_paid active during the configured dunning window; no immediate disable on invoice failure. Never create a first paid grant from past_due alone. |
| `cancel_at_period_end=true` | Remain active through the verified paid-through period end. Use finite entitlement ends_at; show the date. Do not revoke at the request. |
| `unpaid`, `canceled`, or verified actual service end | Deactivate only web_paid. `unpaid` is an access-ending business state, although payment recovery can return that subscription to active. |
| Initial `incomplete_expired` | No paid activation; retire failed checkout attempt. |
| Unexpected `trialing` or `paused` | Not enabled in V1; quarantine for reconciliation/owner review. Do not create paid access automatically or overwrite another valid source. |
| Valid recovery or new paid subscription | Reactivate web_paid, preserve connection and binding; canceled subscriptions require a new subscription rather than mutating the ended one. |

`checkout_pending`, `cancel_at_period_end`, and `ended` are local business concepts/flags, not interchangeable Stripe subscription status strings. Stripe documents retry outcomes and distinguishes paused subscriptions from paused collection. [Subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview).

For a normal auto-renewing active grant, permit an open-ended ends_at so a renewal boundary or delayed webhook does not itself cut access while Stripe retries. Track current period separately in billing state; scheduled cancellation gives the grant a finite end. A terminal projection sets status canceled/expired (preserving historical start/end consistency), never deletes the grant. To clear canceled/expired only a verified current eligible paid restoration can reactivate it.

No local arbitrary past_due timer can override the approved retry policy. Stripe dunning must be configured to reach an access-ending state after exhaustion; leaving subscriptions indefinitely past_due would grant indefinite grace and needs owner resolution. Reconciliation identifies missed terminal events without a live Stripe call in MCP. Stale known access remains during a provider outage; reconciliation lag is an explicit operational risk, not a secret fallback.

## 6. Checkout and billing portal boundaries

Proposed additive endpoints, subject to Phase B review:

- POST `/connectwise/v1/billing/checkout`: authenticated active portal owner, trusted origin, existing secure session boundary, JSON limits, rate limiting and double-submit protection. Product entitlement is not required to pay for restoration.
- POST `/connectwise/v1/billing/portal`: same checks; look up mapped Stripe customer server-side; create short-lived hosted portal session with a fixed approved Monotorr return URL.
- GET `/connectwise/v1/billing/status`: owned-account sanitized billing summary, never secret IDs or unrestricted Stripe payloads.
- POST `/connectwise/v1/billing/webhook`: signature-authenticated provider route; bounded raw bytes, distinct from browser CORS/session handling.

Checkout uses mode subscription, the configured monthly USD Price, quantity one, auto collection, and a server-selected success/cancel destination. Populate client_reference_id and subscription/customer metadata with internal account UUIDs; create/persist the explicit customer mapping. Use a recorded per-account checkout reservation, exact session ID/expiry, and Stripe idempotency keys. Serialize initiation and reject an existing active/retrying/cancel-pending subscription; resume a valid pending session instead of creating duplicates. Reconcile ambiguous API timeouts before another creation. Metadata is corroborating evidence, never permission for an unknown event to claim an account.

Use existing Customer objects and Billing, not Connect/Accounts v2. Email is contact information only; never search email to select an account/customer. A webhook/session's customer, subscription, environment, Price, quantity, and stored account mapping must agree. Account metadata mismatch is quarantined. Resubscription replaces the current subscription reference under an account lock while retaining prior event references; a late old-subscription event cannot cancel the new grant.

Customer Portal handles payment methods, details, receipts/invoices, and period-end cancellation. Configure only the single launch plan; do not enable unsupported upgrades, immediate cancellation, trials, or collection pauses. Resume cancellation is offered only when the configured Stripe portal supports it. Never accept an arbitrary customer ID or arbitrary return URL from a browser. No Monotorr-hosted card fields or card storage. [Stripe Customer Portal](https://docs.stripe.com/customer-management/integrate-customer-portal).

The return page reads local billing/entitlement status. Delayed webhook shows “Payment confirmation pending” with bounded refresh/support guidance; a successful redirect cannot activate access. Existing independent trial/comp/substack access remains usable.

## 7. Webhook and reconciliation design

Minimum proposed allowlist:

| Event | Purpose |
| --- | --- |
| `checkout.session.completed` | Correlate stored checkout/customer/subscription; initiate authoritative reconciliation, not unconditional activation. |
| `customer.subscription.created` / `.updated` / `.deleted` | Reconcile lifecycle, cancellation date, current subscription and service end. |
| `invoice.paid` | Confirm qualifying initial/renewal payment and eligible subscription; activate/restore/update period. |
| `invoice.payment_failed` | Record payment issue; preserve already-granted retry access, reconcile status. |

Use one payment success event, not both overlapping success event families. Launch proposal accepts immediate card-based payments through hosted Checkout; enabling delayed payment methods requires separate support for checkout async_payment_succeeded/failed and paid confirmation tests. No Stripe entitlement feature integration, invoice.created subscription, subscription schedules, or speculative event collection. Payment-action-required notifications and refund/dispute processing require an explicit reason/owner policy before extending the allowlist. Risk cases are monitored in Stripe Dashboard until that policy is approved; they cannot silently delete product configuration. [Subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks).

Verify Stripe-Signature against **unaltered raw request bytes** using the SDK, trusted signing secret, tolerance and server clock. Invalid signature: 400, no write. Separate test/live mode, webhook secrets and provider references. Never log signature headers, raw bodies, keys, Checkout/Portal URLs, email, invoice/card/payment details.

Persist a minimal verified event receipt with a unique provider+mode+event ID before acknowledging durable work. Duplicate receipt returns success; unfinished duplicate remains retryable. Durable processing leases/attempts and bounded retries prevent double application; do not return success while work exists only in memory. A failed durable insert returns retryable 5xx. Unknown valid customer/account/reference is durably quarantined with sanitized reason, not auto-provisioned. Unsupported signed events do not change grants.

Stripe delivery order is not guaranteed. Reconcile the **current authoritative subscription/invoice** rather than replaying stale payloads or trusting event timestamp order. Serialize same-account reconciliation with a fenced lease/version and refetch on conflict; don't hold an unbounded SQL transaction around a network call. After retrieval, atomically update billing projection, source-bounded web_paid grant, and processed receipt, conditioned on the current subscription and lock/version. Release/retry on a lost fence. Catch-up and periodic bounded reconciliation reuse the same processor, outside MCP; retry windows and alerts must be operationally defined. SDK/API calls occur only here and in billing-session creation. [Webhook verification, retries, duplicates and ordering](https://docs.stripe.com/webhooks).

## 8. Minimal proposed storage and privileges

No migration is created here. Phase A determines the next additive migration number and exact constraints.

**account_billing**: account_id primary/FK, provider='stripe', mode, unique provider_customer_id per mode, unique current provider_subscription_id per mode when present, subscription_status, sole provider_price_id, current_period_start/end, cancel_at_period_end, paid_activation_confirmed, last_verified_at, pending_checkout_session_id/expiry, reconciliation version/lease information as required, created_at/updated_at. Price/currency/quantity are checked against server configuration. Period dates are billing metadata, not universal access gates. Keep account identity independent from provider references.

**billing_events** is needed for reliable idempotency: provider/mode/event_id unique, event_type, provider event timestamp, customer/subscription/session references where required, resolved account_id nullable, received_at, processed_at, processing status/result category, attempt count, bounded lease/retry fields. Retain old subscription references in this minimal journal so superseded events are identifiable. Store no complete webhook or payment-method payload. Define retention/PII deletion policy before implementation; event receipts must outlive supported retry/replay windows.

Use one independently mutable web_paid entitlement per account (proposed source-specific unique index after auditing existing rows); retain event history separately. Never collapse other sources into account_billing. Null ends_at is already schema-supported; timestamps and transitions must preserve ends_at > starts_at where non-null.

Prefer a narrowly reviewed SQL function/source-restricted billing writer that can activate/deactivate **only the mapped account's web_paid row**, rather than granting cw_control global entitlement UPDATE/DELETE. If SECURITY DEFINER is selected, require fixed search_path, qualified objects, controlled owner, revoked PUBLIC execution and validated mapping/source predicates. Audit the existing broad source-capable INSERT grant before choosing the least-privilege boundary. Reader `cw_mcp` receives no billing writes, billing-secret access, customer management privileges, or Stripe client. Preserve its narrow metadata SELECT grants and persistent identity-binding protections.

## 9. Configuration, price and tax

Proposed nonsecret config: billing feature flag (default off), Stripe Product ID, immutable Price ID, pinned API version, expected currency USD/amount 2900/interval month/quantity 1, mode, fixed return origins and portal configuration ID. Product/Price IDs are environment configuration, not source constants; validate retrieved Price attributes before checkout. Separate test/live resources. Secret key and webhook signing secret use approved Key Vault/managed identity conventions, scoped to the billing runtime only; never expose browser secrets, source files, logs or GitHub artifacts. Price creation, secret creation/RBAC and webhook registration each require separately scoped approval.

Tax is a commercial compliance decision. If enabled, Stripe Tax needs account/business settings, registrations, product tax code/tax behavior, location collection and Checkout automatic_tax settings; allow Stripe to calculate and collect it. Owner must select inclusive versus additional tax treatment for the advertised $29 and selling jurisdictions with appropriate advice. Stripe does not eliminate seller responsibilities; no Monotorr tax engine. Architecture is valid without choosing a tax implementation here, but live charging requires the commercial launch decision. [Stripe Tax with Checkout](https://docs.stripe.com/tax/checkout).

## 10. Customer-facing account UX

| Customer condition | Display / actions |
| --- | --- |
| Valid trial | Trial active, original expiration, Subscribe / Upgrade; $29/month. |
| Valid paid | Access active; price; optional verified renewal or paid-through date; Manage billing. |
| Retryable payment issue | Payment issue; Manage billing; explain access continues while payment is retried. |
| Scheduled cancellation | Access remains active until the verified date; Manage billing; resume only if supported. |
| No valid product source | Access inactive; Subscribe; suppress product onboarding actions, preserve existing configuration. |
| Valid comp/substack alongside failed paid | Access active plus separate payment notice; no contradictory blanket denial. |
| Checkout confirmation pending | Pending confirmation; no payment-success claim based on URL. |

Keep the approved ConnectWise → Connect your AI → Ready to connect journey and Fira brand system. Billing controls remain usable without paid product access, but require authenticated ownership. No raw web_paid/provider status/IDs, and no assertion of external ChatGPT connectivity. Billing restores access to saved configuration; no reconnect wizard or credential deletion.

## 11. Failure behavior and recovery

| Failure | Required result |
| --- | --- |
| Abandoned checkout | No paid grant; pending reservation expires/reconciles; trial unaffected. |
| Successful checkout, delayed webhook / return without confirmation | Pending UX; no browser-authorized activation; durable reconciliation. |
| Duplicate / out-of-order event | Idempotent receipt and current-state reconciliation; old event cannot reverse new subscription. |
| First payment failure | No first paid activation; retain valid independent sources. |
| Renewal failure / repeated retries | Preserve provisioned web_paid until configured terminal outcome; payment-help UX. |
| Terminal unpaid/canceled/end | Only web_paid inactive; denied requests stop before credential and CW access. |
| Period-end cancellation | Access through recorded boundary; expiry evaluates locally even if end event is delayed. |
| Payment restoration / resubscription | Verified paid eligibility reactivates same account grant; saved connection/binding unchanged. |
| Stripe API/Customer Portal unavailable | Sanitized recoverable error; no entitlement corruption; MCP uses existing local grants. |
| Missing/malformed metadata, unknown/deleted account or customer | Quarantine/retry investigation; no email fallback, automatic account creation, or grant. |
| Multiple sources | ANY valid grant wins; paid failure cannot revoke another source. |
| Ambiguous duplicate subscription / API timeout | Stop new checkout; reconcile known mappings before charging again. |
| Database/worker failure | Roll back projection/grant/event transaction; durable retry; no lost receipt or partial grant. |

Never remove accounts, secrets, connections or bindings as a payment side effect. Operator recovery replays/reconciles trusted events; it is not an authorization override.

## 12. Implementation phases and approval gates

A — **Current-state audit**: trace schema/privileges, trial creation/evaluation, portal/setup/MCP gate, session ownership, linking boundaries, migration manifest/checksum conventions, secret identities, multi-source fixtures, delivery impact and rollback. Inspect Stripe test/live/API versions and dunning/portal settings read-only when access is separately provided. Resolve the conversion detail, paused/collection behavior and tax/dunning choices. Produce exact bounded migration/function/service/endpoint/test design; no provisioning or deployment from this plan.

B — **Billing data + Stripe service**: additive reviewed schema/privileges; server-side client; owned Checkout/Customer Portal creation; signature/raw-body route; durable receipts, mappings and workers. Start in test mode, feature disabled. No live resource/secret creation without approval.

C — **Entitlement integration**: shared ANY-valid-source predicate; source-only web_paid transitions, retry grace, finite cancellation, renewal/recovery, trial retention, source-independent comp/substack, bounded reconciliation. Preserve entitlement-denial ordering and independent session authentication.

D — **Portal**: approved account billing labels, Subscribe/Manage billing, payment-pending/help/cancellation states and recovery access; no card form or custom billing UI.

E — **Acceptance and delivery**: test trial/no card, valid/abandoned/failed Checkout, signed activation, invalid signatures, duplicates/concurrent/out-of-order/old-subscription events, webhook delays, terminal state, cancellation boundaries, restoration, trial/comp/substack combinations, null ends, invalid grants, cross-account Checkout/Portal denial, raw-body handling and outage reconciliation. Prove denied execution causes **0 customer-secret GETs / 0 ConnectWise calls**, while restored access uses unchanged saved configuration. Regress session/origin/state/PKCE, issuer/audience/scope, USER A denial and USER C isolation, schemas and **39 reads / 0 writes**. Test that MCP imports/calls no Stripe SDK/API.

Entitlement evaluator changes affect reachable MCP modules: preserve existing immutable same-SHA provenance, migration compatibility, accepted candidate tests, rollout/traffic readback and rollback guards. Do not claim control-only delivery for changed or unknown MCP impact. Deploy readers that understand new grants before enabling paid checkout; make no charges while production still enforces trial-only access. A rollback to trial-only code could deny paid-only customers: define a compatible retained rollback artifact and feature-disable checkout without deleting grants, then review deployment order before launch. Separate approvals cover commit/push, Stripe test/live provisioning, secrets/RBAC, migration, builds, control/MCP/portal delivery and commercial enablement.

## 13. Non-goals and definition of done

Exclude annual/tiers/seats/usage, coupon UI, reseller/team billing, custom invoices/tax engine, admin console, readiness assessment, website pricing/marketing implementation, new MCP tools, and billing-triggered deletion/disconnection. Identity replacement stays future recovery work independent of durable billing.

Launch is complete only when the no-card 30-day trial and $29 monthly hosted Checkout work; trusted webhooks activate paid access; retry failures preserve service; terminal paid endings deactivate only web_paid; scheduled cancellation honors the paid period; restoration needs no CW reconnection; comp/substack remain independent; owned Customer Portal works; idempotency/isolation and zero-call denial tests pass; no email-only association/card storage exists; secrets are scoped; 39 reads/0 writes and compatible rollback pass. Logo and deferred consent rendering are not billing implementation scope.

## 14. Genuine remaining decisions and assumptions

Settled: Stripe, $29/month, monthly-only, 30-day no-card trial, retryable past_due retains access, terminal paid end removes only web_paid, saved configuration preserved, independent comp/substack. Do not reopen these as blockers.

Owner review still needed for: (1) exact retry/dunning duration, final Stripe outcome and status-resolution setting; (2) confirming original-trial coexistence after conversion versus explicit retirement while preserving history; (3) tax enablement, jurisdictions and whether $29 includes taxes; (4) immediate card-only launch versus additional delayed methods; (5) refund/dispute/manual paused-collection policy; (6) whether renewal date is useful in portal. SDK/API pin, event field paths, reconciliation cadence/alerts and least-privilege SQL mechanism are implementation audit choices, not new pricing decisions. `unpaid`/`canceled`/`incomplete_expired` are identified lifecycle cases; verify the configured account's actual event behavior in test mode before enabling live billing.

This documentation authorizes no implementation, database mutation, Stripe resource creation, deployment or Phase 4 expansion. The only authorized repository change in this task is this plan's documentation commit and push.
