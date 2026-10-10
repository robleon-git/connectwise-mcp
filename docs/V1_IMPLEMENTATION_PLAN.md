# Monotorr ConnectWise MCP — V1 Implementation Plan

Status: Phase 0 accepted. Phase 1 Slice 1 is approved and its repository implementation is locally validated; source publication/deployment review and live acceptance remain pending. No later slice or phase is authorized.

Scope authority: [V1 Product Architecture](V1_PRODUCT_ARCHITECTURE.md), including Section 37 (admin identity separation) and Section 38 (Cloud and customer-hosted support). The architecture takes precedence over this plan.

Delivery constraint: Every vertical slice is built for the intended Azure runtime, deployed through the same repeatable delivery path, and smoke-tested there. There is no later project to convert a local application into a production application. Production-shaped does not mean publicly available: incomplete features remain server-side gated.

All proposed repository paths below are relative to `/Users/rleon/Development/connectwise-mcp`. Files/modules listed are planned work, not claims that they already exist.

## Delivery rules for every phase and slice

A phase or vertical slice is not complete until all four gates pass:

1. Focused local/unit/integration tests, including the slice's authorization and failure cases.
2. Normal regression tests, builds, lint, production and full dependency audits, ticket-card output validation, and diff checks. Preserve the existing exact 39-tool inventory and GET-only enforcement tests.
3. Successful deployment of the tested artifacts through the Phase 0 Azure delivery path, including any controlled migrations.
4. Successful deployed smoke tests for that slice, with sanitized evidence and a recorded release/revision/digest.

The existing root gates are `npm run build:ui`, `npm run build`, `npm run lint`, `npm test`, `npm audit --omit=dev`, `npm audit`, `npm run validate:ticket-card`, and `git diff --check`. Extend CI to cover new portal/API packages when introduced; do not leave their checks outside the release gate. Database integration tests use a disposable test database, not destructive resets of the shared Azure product database. The full dependency audit remains a release gate: findings must be resolved, without audit-force, advisory suppression, or framework downgrades.

Deployment failures, missing deployed evidence, or only-local success mean the slice remains incomplete. Deployments and external configuration changes require authorization when executed; this planning document performs none.

## Phase 0 — Production Delivery Foundation

Architecture mapping: Sections 29–30, 33, 38; supports every acceptance gate in Sections 34–35.

### Objective and limits

Establish the smallest reusable Azure delivery spine. Reuse the existing Microsoft/Azure tenant, approved registry/environment resources, Docker build, and CI checks where suitable. Keep ConnectWise operationally independent from Monotorr 365.

Do not introduce AKS, APIM, a new gateway, a generalized infrastructure framework, or a permanent dev/staging/prod matrix. Use one controlled Azure product environment initially, with candidate Container App revisions and server-side feature gates for safe testing. Local development and disposable CI test resources are not additional hosted product environments.

### Intended runtime

| Component | Intended Azure runtime/boundary |
| --- | --- |
| Portal | Azure Static Web Apps, serving a minimal React/Vite shell initially; no customer secrets in frontend build settings. |
| Control-plane API | One dedicated Azure Container App for the ConnectWise setup/account API, using the established Monotorr Express/TypeScript pattern and a separate runtime identity. The initial deployable exposes only health/status needed to prove delivery. |
| MCP service | Preserve the existing `connectwise-mcp-pilot` Container App and canonical `https://api.monotorr.com/mcp`. Evolve its application through reviewed releases; do not replace DNS or route it to Monotorr 365. |
| Product database | Dedicated ConnectWise PostgreSQL server/database and roles in monotorr-connectwise-prod-rg. Do not place the product database on the existing Monotorr B1ms server. |
| Secret storage | Azure Key Vault with product-specific, server-generated customer secret references. Separate control-plane write access from MCP read access; deployment identity does not need customer-secret read permission. |

A separate control-plane app is justified by its configuration-write responsibility and identity boundary, not by a desire to split every module into a service. No additional domain services or workers are required by this phase. Confirm portal/API hostnames and their relationship to existing routing before configuring them; do not assume a Monotorr hostname is free.

Azure references: [Static Web Apps](https://learn.microsoft.com/en-us/azure/static-web-apps/overview), [PostgreSQL](https://learn.microsoft.com/en-us/azure/postgresql/overview), [Container App managed identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity).

### Small vertical slices

**0A — Capture baseline and prove artifact delivery.** Record the live revision, immutable MCP image digest, ingress/custom-domain mapping, OAuth nonsecret settings, secret-reference names, and current 39-tool smoke result. Keep credential values and bearer tokens out of release evidence. Build and deploy a gated portal shell and health-only control API through the intended path.

**0B — Prove database and identity wiring.** Establish database TLS/connectivity, runtime-versus-migration roles, managed identity/Key Vault access patterns, and a versioned migration ledger. Apply an initial harmless foundation migration through the release path. Customer schema is added in Phase 1.

**0C — Exercise release and rollback.** Deploy a candidate, run health/authentication smoke tests, promote deliberately, then exercise rollback without modifying canonical MCP routing or weakening authentication. Confirm that incomplete routes remain inaccessible.

### Files/modules likely to be created or modified later

- `.github/workflows/ci.yml` and a small reviewed deployment workflow.
- `scripts/deploy/` for artifact build, migration invocation, deployment, smoke checks, and rollback commands.
- `Dockerfile`, plus control-plane container packaging when its shell is introduced.
- `portal/` and `src/control-plane/` minimal deployable shells.
- `src/database/migrationRunner.ts`, `database/migrations/`, and a migration ledger contract, adapted from Monotorr's checksum/locking pattern.
- `docs/V1_AZURE_DELIVERY_RUNBOOK.md` and a nonsecret environment/configuration contract.

Keep the provisioning mechanism small: explicit repeatable scripts/templates for these resources only. Do not create an infrastructure platform.

### Database deployment/migration path

Use a dedicated migration identity/role and a constrained application role. Run versioned, checksummed migrations as a controlled release step from an approved runner with database network access; never run migrations independently from every API replica at startup. Validate migrations against a disposable PostgreSQL instance in CI.

Prefer additive, backward-compatible migrations before application promotion. A failed migration blocks promotion. Destructive changes require a separately reviewed compatibility/backup procedure; automatic down migrations are not the default rollback path.

### Identity, configuration, and delivery

- Use managed identity for runtime Key Vault access; retain local `DefaultAzureCredential` only for authorized development. Customer credentials never enter images, CI artifacts, frontend assets, logs, or ordinary environment files.
- Keep nonsecret configuration versioned and schema-validated: deployment targets, allowed portal origin, database connection settings, Descope issuer/JWKS/resource/scope, global Monotorr Client ID, and feature gates.
- Keep secrets or sensitive connection credentials in approved secure references. Record versions/references rather than values in the release manifest.
- Use a restricted deployment identity, preferably GitHub-to-Azure federation, rather than a broad long-lived Azure credential. No Microsoft 365 administrative permissions.
- Build once from a known source revision with a lockfile and existing production architecture (`linux/amd64` unless deliberately changed). Publish to the approved ACR repository; deploy by immutable digest, not a mutable tag alone. Package portal assets with the same release identifier.
- Release order: verification → immutable artifacts → compatible migration → gated candidate deployment → deployed smoke → deliberate promotion → canonical endpoint smoke.

### Health, gating, and rollback

Use Azure startup/readiness/liveness probes on the NEW control API, not only Docker HEALTHCHECK. Preserve existing MCP probes/revision mode/traffic during Phase 0. Keep liveness independent of ConnectWise, account entitlement, and temporary database outages; readiness may check the API's required configuration/schema/database availability without touching customer keys. Public health responses reveal no customer status or secret values.

Use server-side, default-off feature gates and controlled enrollment. Hiding a UI link is insufficient. Gates never bypass OAuth, entitlement, account ownership, or admin separation. Disabled signup/billing/admin operations are denied by the API even when deployed. Testing identities remain ordinary customer accounts with ordinary entitlements.

Phase 0 does not create or promote an MCP candidate, modify MCP traffic/revision mode/probes, or deploy a new MCP image. Candidate promotion/rollback exercises apply to the NEW control API. When a later actual MCP change requires deployment, keep the old MCP revision serving the canonical endpoint while evaluating a reviewed candidate where supported. A revision-directed SDK probe may target the candidate while still validating the canonical resource/audience; do not rewrite OAuth metadata or change the public MCP URL. Smoke-test the canonical URL after promotion. Preserve Authorization and WWW-Authenticate behavior, protected-resource metadata paths, HTTPS, and no response caching for authenticated MCP traffic.

Retain a known-good revision/digest and matching portal artifact for rollback. Track app-wide configuration separately: image/revision rollback does not undo database migrations, Key Vault changes, or all Container App settings. Do not blindly restore old secret references, entitlement data, or disconnected connection state. After Phase 3, a global-credential pilot revision is not an eligible customer-serving rollback target; if no safe account-aware revision exists, fail closed rather than restoring global customer resolution. [Container App revisions and configuration scope](https://learn.microsoft.com/en-us/azure/container-apps/revisions).

### Tests and acceptance

Focused tests: configuration validation, migration idempotency/checksums/locking, disabled-route gates, sanitized health output, packaging without secrets, and release/smoke script failure handling.

Normal regression: existing MCP build/UI build/lint/tests/audit/diff checks, plus shell/API delivery checks.

Deployed smoke: portal shell loads; control API health and readiness work; disabled feature routes remain denied; database schema version is correct; canonical MCP discovery, anonymous 401/challenge, authenticated SDK handshake, and exact 39-tool inventory remain unchanged. A connectivity read uses only the approved test account and prints no response body.

Acceptance: one repeatable release and rollback exercise succeeds, with immutable artifacts and sanitized evidence. No public signup, new customer credential workflow, billing integration, or SaaS authorization change is introduced merely to finish Phase 0. Remaining foundations are delivered incrementally through this same path.

## Phase 1 — Customer identity, account, and entitlement foundation

Architecture mapping: Sections 4–8, 18–19, 31, 33, 37.

**Objective/slices:** (1) Microsoft business login and idempotent account creation; (2) browser session and explicit portal/Descope identity linkage; (3) 30-day trial and entitlement evaluation; (4) separate super-admin identity boundary. Do not activate new customer MCP access yet.

**Modules:** `src/accounts/`, `src/entitlements/`, `src/control-plane/auth/`, `src/database/`, portal login/Home; extend the verified-principal contract in `src/auth/descope-mcp.ts` without weakening token verification. Selectively adapt Monotorr patterns, correcting previously identified OIDC/session weaknesses.

**Schema:** `users`, `accounts`, `account_memberships`, `external_identities`, `auth_sessions`, `entitlements`, separate super-admin identity registry, minimal sanitized `audit_events`. Unique external identity and one customer-account resolution per customer user; acquisition source remains separate. Entitlement sources are exactly `trial | web_paid | substack | comp`.

**Backend/UI:** Login/callback/logout/session and account-status API; minimal login/Home/entitlement/logout screen. Account context is server-resolved. Identity linkage requires proof, never email-only matching. Rob's account receives the normal customer treatment. Admin-only identity is not automatically provisioned a customer account or trial.

**Security/focused tests:** Signup concurrency, duplicate/link-substitution attempts, state/nonce validation, expired/revoked sessions, entitlement time boundaries, cross-account lookup, and customer/admin separation.

**Regression/deployment/smoke:** Pass normal gates; migrate/deploy through Phase 0 with controlled enrollment. Two business identities log in to the deployed portal and resolve to distinct accounts and real trial states. Deployed admin-only identity cannot use customer endpoints. Existing pilot MCP still passes its approved regression smoke.

**Acceptance:** Every customer identity resolves to one account with an independently evaluated entitlement. Unknown/ambiguous mappings fail closed. No new customer MCP activation occurs before Phase 3 wiring. Phase 2 connection validation has its own account/entitlement gate.

## Phase 2 — One secure ConnectWise connection per account

Architecture mapping: Sections 12–17, 20, 27–28, 33, 38.

**Objective/slices:** (1) Validate four inputs and securely save; (2) GET-only connection test and sanitized status; (3) replace credentials/disconnect/reconnect. Same setup for Cloud and on-premise.

**Modules:** `src/connections/`, `src/security/outbound-target.ts`, account-scoped extension to `src/config-loader.ts`/`src/config.ts`, control-plane connection routes, portal ConnectWise screen. Preserve existing API authentication construction.

**Schema:** `connectwise_connections` with unique `account_id` for the V1 current record, URL/company, opaque credential references/version, status/test timestamps/sanitized failure/disconnect state. Replacement updates that record; history is audit data. No key values or customer Client ID in ordinary tables.

**Backend/UI:** Save/status/test/replace/disconnect/reconnect operations use authenticated account context. Backend adds the mandatory global Monotorr Client ID; customers enter only URL/company/public/private key. Stored keys are never redisplayed. Publish a new credential pair only after both secure writes succeed; handle partial failures safely.

**Security/focused tests:** Ownership before secret operations; entitlement before customer credential retrieval/read tests; outbound target and DNS/redirect controls; verified TLS; concurrent saves; partial Vault failures; foreign references; disconnect; secret redaction; both deployment-model URL fixtures. Begin without a shared hosted customer-credential cache.

**Regression/deployment/smoke:** Pass normal gates; deploy schema/API/UI through Phase 0. Two entitled deployed accounts independently save/test their own credentials, cannot retrieve each other's status/references, and safely replace/disconnect. Record only sanitized outcomes.

**Acceptance:** Each account has at most one active connection; keys are securely isolated; disconnect stops new reads. New accounts remain gated from MCP until Phase 3 completes.

## Phase 3 — Account-aware MCP execution: early isolation milestone

Architecture mapping: Sections 3–6, 18–19, 30, 33, 37–38.

**Objective/slices:** (1) Resolve verified MCP principal to internal customer/account; (2) enforce account status, entitlement, and connection state; (3) inject only that account's credentials; (4) prove concurrent two-account operation at the same public endpoint.

**Modules:** `src/auth/customer-access.ts`; modify `src/auth/descope-mcp.ts`, `src/http-server.ts`, `src/config-loader.ts`, `src/config.ts`, and `src/index.ts`. Preserve `src/tools/`, the existing transport, and the 39-tool registration. Extend operator diagnostics only as needed for account-aware, sanitized verification.

**Schema:** Use foundation tables; add only necessary scoped lookup indexes/constraints. No new hierarchy or selectable connection model.

**Backend/UI:** Every hosted MCP request: verify token → user → account/status → valid entitlement → active connection → credentials → global Client ID → existing read-only client/tools. Database/entitlement uncertainty denies access with zero secret reads, including cached material. No fallback to global pilot keys. Metadata/health remain nonsecret and do not retrieve keys. Minimal AI Setup instructions point to the unchanged canonical endpoint.

**Security/focused tests:** Unknown/disabled/admin-only principals; invalid/expired/revoked entitlements; zero Vault/client/network calls on denial (including initialize/tools/list); cross-account IDs/headers/arguments/reference substitution; concurrent distinct clients; exact 39 tools; GET-only; global Client ID; disconnect/rotation; SDK protocol regressions. Entitlement gating exists now, not deferred to Phase 5.

**Regression/deployment/smoke:** Pass normal gates; deploy an account-aware candidate through Phase 0, validate before canonical promotion. Authorize migration of the existing pilot identity/connection explicitly; no email-based or owner privilege exception. Existing pilot must pass as a normal customer after transition.

**Acceptance milestone:** Two customer identities use `https://api.monotorr.com/mcp`, list exactly 39 tools, and representative reads return only their respective data. Attempts to cross-resolve fail. Revoking A's entitlement denies A without loading credentials while B continues working. Test concurrent requests and signed MCP tokens, not only mocked user IDs. Prefer one Cloud and one on-premise instance here; both are mandatory before launch.

## Phase 4 — Onboarding, bounded permissions, and one readiness experience

Architecture mapping: Sections 15–17, 21–24, 35.

**Objective/slices:** (1) Next-action/onboarding state; (2) bounded representative read-permission checks; (3) one structured readiness experience; (4) customer AI-client setup guidance.

**Modules:** Extend `src/connections/`; `src/readiness/`; portal Home/ConnectWise/AI Setup/Account; customer documentation under `docs/`. Use existing tools; add no new MCP tools or general execution engine.

**Schema:** `onboarding_state` and bounded permission-check summaries, separate from entitlement. Do not persist raw assessment results without a demonstrated need.

**Backend/UI:** Scoped progress/permission-check API; useful setup guidance and structured readiness result through the approved execution location. A successful connectivity test is not a claim that every permission exists.

**Security/focused tests:** Bounded requests/output, GET-only, entitlement-before-secrets, partial/denied permissions, empty data, foreign onboarding records, sanitized failure summaries. Onboarding completion never grants entitlement.

**Regression/deployment/smoke:** Pass normal gates and deploy through Phase 0. A controlled new customer completes configuration, representative permission checks, AI setup, and the readiness experience using the deployed portal/API/MCP.

**Acceptance:** Customer reaches a useful result without operator intervention. Cloud/on-premise share one setup flow. No operational ConnectWise dashboard or broad assessment framework is introduced.

## Phase 5 — Stripe and all entitlement acquisition paths

Architecture mapping: Sections 6–11, 21, 34–35.

**Objective/slices:** (1) Stripe checkout and subscription management; (2) signed/idempotent billing events; (3) Substack claim; (4) overlapping-source transitions and full commercial entitlement lifecycle. Existing trial and entitlement enforcement remain active throughout.

**Modules:** `src/billing/`, `src/substack/`, entitlement service, portal Billing and `/substack` entry experience. Adapt Monotorr Stripe patterns. Billing network calls do not enter the MCP request path.

**Schema:** `subscriptions`, necessary external references, webhook deduplication records. Acquisition history remains separate; Substack claim updates the same account. Complimentary access is not a fake Stripe subscription.

**Backend/UI:** Server-resolved checkout/customer ownership; verified events update entitlement; Billing explains current source and relevant actions. No forced Stripe flow for trial/Substack/comp. Checkout redirects alone do not grant access.

**Security/focused tests:** Forged/replayed/out-of-order events, foreign subscription IDs, cancellation/renewal/failed payments, duplicate claims, trial expiry, overlapping sources, and double-charge prevention.

**Regression/deployment/smoke:** Pass normal gates; deploy through Phase 0 with enrollment gates. Run Stripe test-mode transactions/webhooks against the deployed API and verify resulting MCP allow/deny and zero credential retrieval on denial. Exercise the approved Substack verification path on the deployed claim flow. Test mode is secure provider configuration, not a duplicate Azure staging estate. Live Stripe mode requires its own controlled enablement gate before launch.

**Acceptance:** All four entitlement paths operate correctly without changing identity or connection. Paid lifecycle is complete for launch, but none of this blocks the Phase 3 isolation milestone.

## Phase 6 — Separate super-admin support console

Architecture mapping: Sections 26, 28, 37.

**Objective/slices:** (1) Admin identity/session guard and account lookup; (2) safe status/onboarding/billing diagnostics; (3) audited complimentary grant/revoke.

**Modules:** `src/admin/`, separate admin route area in the portal, existing account/entitlement/audit repositories. Do not derive admin rights from customer email or ownership.

**Schema:** Use the distinct admin identity registry; add audited actor/target references as needed. Admin identity has no customer membership or inherited entitlement.

**Backend/UI:** Explicit admin-only, allowlisted support APIs. No generic database/secret browser, impersonation, or customer data access shortcut. Support diagnostics cannot bypass entitlement or disconnected state.

**Security/focused tests:** Customer sessions rejected on admin APIs; admin-only identity rejected on MCP; separate authorization/session context; serializers exclude keys/tokens/raw responses; complimentary changes are scoped and audited; Rob's account remains ordinary.

**Regression/deployment/smoke:** Pass normal gates; deploy through Phase 0 behind the separate admin authorization gate. Separate admin identity finds controlled accounts and manages comp access without reading keys. Deployed normal customer and admin-only identities fail in the opposite authorization domains.

**Acceptance:** Support can administer permitted account/entitlement/status data without customer-secret exposure or bypassing isolation.

## Phase 7 — Launch validation, documentation, monitoring, compatibility, and polish

Architecture mapping: Sections 25, 28–30, 35, 38.

**Objective/slices:** (1) Durable first-access onboarding email sequence; (2) GitBook/customer/support guidance; (3) sanitized operational monitoring and compatibility validation; (4) final UI/accessibility/content polish and external-customer rehearsal.

Deployment packaging, primary CI/CD, migrations, runtime configuration, health checks, and rollback already exist and are routine. This phase validates and refines them; it does not introduce a separate production-readiness migration.

**Modules:** `src/communications/`, narrowly necessary delivery/idempotency tracking, existing portal/docs/GitBook publication and operational smoke tooling. Adapt Monotorr Resend patterns; no general workflow engine.

**Schema:** Minimal durable delivery/idempotency records if needed; audit coverage for required account/connection/entitlement events. No unbounded customer data warehouse.

**Backend/UI:** `first_access_granted` triggers the activation sequence once regardless of entitlement source. Complete next-action/help/billing/setup copy. Monitoring records only sanitized operational categories and statuses; support views do not expose customer API bodies.

**Security/focused tests:** Email duplication/retries and access-source transitions, safe monitoring/audit serialization, disabled/deleted account behavior, compatibility fixtures, and final customer/admin/isolation regressions.

**Regression/deployment/smoke:** Pass normal gates and deploy through the same Phase 0 path. Rehearse an external customer's complete journey and subscription return visit. Verify launch-supported AI clients, real OAuth refresh/reconnect, exact 39-tool discovery, and representative reads against at least one Cloud and one on-premise instance. Validate final live provider configuration with controlled authorization before public enrollment.

**Acceptance:** Definition of V1 Complete passes. Delivery remains repeatable, observed, and reversible; both Manage hosting models are validated; no global customer credentials, privileged-owner exception, write capability, or untested launch flow remains.

## First work and decisions

Start with Phase 0A: capture the current deployment/routing baseline and prove the gated portal/control-plane artifact path without altering the working MCP endpoint. Complete 0B/0C, then deliver Phase 1 in small slices through that same path.

Decisions before Phase 0 execution: approved subscription/resource reuse; dedicated product database/server and reachable migration runner; portal/control API hostnames and cookie/origin policy; runtime/deployment identities and minimal RBAC; release approval/rollback operator. Resolve actual values from authorized infrastructure inspection, not historical runbook guesses.

Decisions before relevant product slices: verified Entra/Descope identity linkage across customer tenants; initial entitlement validity/transitions and admin bootstrap; secret replacement/retention/in-flight policy; outbound target policy; entitled-but-unconfigured MCP discovery behavior; Substack eligibility/verification and Stripe overlap handling; bounded readiness output/execution; launch-supported AI clients and activation email timing.

## Preserve existing behavior

Keep the canonical MCP URL, Descope authorization-server architecture, token signature/issuer/audience/time/scope checks, OAuth challenges/metadata, SDK protocol handling, 39 read-tool names/schemas/handlers, GET-only client guard, Basic authentication construction, verified TLS, redirect rejection, safe diagnostics, and read-only ticket card. Change surrounding account authorization/configuration only where V1 requires it. Do not revive legacy simulated OAuth, global customer configuration in hosted SaaS, or removed write tools.

Local environment/stdio diagnostics may remain explicitly local. They are not a hosted SaaS fallback and cannot be used to bypass account/entitlement rules.

No organization switching, multiple connections, provider hierarchy, invitations, ownership transfer, write tools, multi-PSA support, speculative shared platform, or generalized automation is included.


## Approved Phase 0 delivery constraints

Use monotorr-connectwise-prod-rg for new product resources, a dedicated PostgreSQL server, the existing shared ACA environment/ACR, and cw-mcp-kv. Existing MCP routing/revision mode/traffic/probes and Descope settings remain unchanged. Repository implementation and exact pending live actions are in [Azure delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md).

Every MCP-affecting release requires the manual [owner dogfood smoke](OWNER_DOGFOOD_SMOKE_TEST.md), using the ordinary customer identity, valid entitlement/own connection as implemented, production ChatGPT and the canonical endpoint. Separate admin identity must not replace this test. Phase 0 does not deploy MCP.

## Approved Phase 0 closure decisions

- Replace the inherited single-file plugin with the narrowly scoped ticket-card inliner; preserve byte-identical embedded HTML and require its validation in both CI/release verification.
- Bootstrap the dedicated product database through a separate bounded manual job inside the existing ACA/VNet. No operator laptop or GitHub runner SQL path. Runtime and migrator identities remain distinct. Remove the temporary job, its three secret-scoped grants and bootstrap password access after success/failure; cleanup is a release gate.
- Accept registry-scoped AcrPush for the dedicated environment-federated GitHub OIDC identity while the shared ACR uses LegacyRegistryPermissions. No Phase 0 ABAC migration, ACR admin credential use, subscription Owner grant, or changes to existing pull assignments.

Exact resource placement/actions, bootstrap recovery limits and scoped permissions are in [the delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md). These decisions introduce no Phase 1 customer functionality and do not change the V1 product architecture baseline.


## Phase 1 Slice 1 permanent-host design update

Approved portal origin: `https://portal.monotorr.com`; approved API origin: `https://api.monotorr.com`. Proposed dedicated API namespace: `/connectwise/v1`, with Web callback `https://api.monotorr.com/connectwise/v1/auth/callback`. No separate control API hostname is proposed. See [Slice 1 auth design](PHASE1_SLICE1_AUTH_DESIGN.md) for exact-origin CORS, host-only scoped cookies and the additive existing-router proposal.

The owner resolved the previously discovered portal conflict: preserve `app.monotorr.com` on `monotorr-portal`, bind `portal.monotorr.com` only to `connectwise-portal`. The separate organizational-account browser registration is approved and created; no Graph API permissions or personal accounts are enabled. No admin identity is designated or required for this slice; admin functionality remains absent. Identity, trial and session code resides only in the separate control API. Existing MCP remains unchanged. See the Slice 1 design and delivery runbook for implemented modules and pending deployed acceptance.
