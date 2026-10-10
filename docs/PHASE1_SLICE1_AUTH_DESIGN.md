# Phase 1 Slice 1 — customer browser authentication design

Status: **Phase 1 Slice 1 acceptance PASS (2026-10-10)**. Deployment, real customer login/logout/re-login, read-only database evidence and production account-isolation checks passed. Publisher verification remains a pre-launch requirement, not a Slice 1 blocker. Slice 2 is not started.

Scope: Microsoft business login → internal user → one customer account → one 30-day trial → account-status screen → logout. Scope authority remains [V1 architecture](V1_PRODUCT_ARCHITECTURE.md) and [implementation plan](V1_IMPLEMENTATION_PLAN.md). This slice does not change MCP, link Descope identities, collect ConnectWise credentials or implement later entitlement acquisition paths.

## Approved permanent origins

- Customer portal: `https://portal.monotorr.com`.
- Control API origin: `https://api.monotorr.com`.
- MCP remains `https://api.monotorr.com/mcp`.
- Do not create another control API hostname. Azure-generated app FQDNs remain deployment/candidate verification targets, not customer authentication URLs.

## Approved namespace and browser routes

Dedicated API base: `https://api.monotorr.com/connectwise/v1`.

| Method | Public route | Purpose |
| --- | --- | --- |
| GET | `/connectwise/v1/auth/login` | Start Microsoft authorization code flow with PKCE S256, state and nonce |
| GET | `/connectwise/v1/auth/callback` | Server-side code exchange and verified identity resolution |
| POST | `/connectwise/v1/auth/logout` | Revoke browser session and clear the scoped cookie |
| GET | `/connectwise/v1/session` | Return minimal current customer session or sanitized 401 |
| GET | `/connectwise/v1/account/status` | Resolve account from session; evaluate trial server-side; report ConnectWise not configured |

Exact Microsoft **Web** redirect URI: `https://api.monotorr.com/connectwise/v1/auth/callback`. Successful login and logout return to the fixed portal root `https://portal.monotorr.com/`; no arbitrary caller-controlled redirect destination. The portal invokes the API with credentials included. It does not receive Microsoft tokens or use localStorage for auth.

Account context is derived exclusively from the server-side session and current membership. No account-selector parameter/header is supported. Unknown, invalid or ambiguous identity/membership resolution fails closed.

## Existing shared-host routing — read-only verification

On 2026-10-10, ARM GET API `2025-07-01` identified the existing environment HTTP route configuration:

`monotorr-dev-eastus-rg / monotorr-prod-aca-env / monotorr-api-routing`.

Its `api.monotorr.com` domain uses an existing SNI managed certificate. Ordered rules are:

1. Exact case-sensitive `/mcp` and `/.well-known/oauth-protected-resource/mcp` → `connectwise-mcp-pilot`.
2. Prefix `/` → `monotorr-api-prod`.

This resolves the previously documented routing unknown. The proposed additive rule is inserted **between** these existing rules:

```json
{
  "description": "ConnectWise customer control API",
  "routes": [
    {"match": {"path": "/connectwise/v1", "caseSensitive": true}, "action": {}},
    {"match": {"pathSeparatedPrefix": "/connectwise/v1", "caseSensitive": true}, "action": {}}
  ],
  "targets": [{"containerApp": "connectwise-control-api"}]
}
```

Preserve the entire existing domain/certificate configuration, MCP rule, targets, and fallback. No path rewriting, MCP app change, DNS change for `api.monotorr.com`, or Monotorr API application deployment is proposed. The exact/boundary match includes the namespace root and descendants while excluding `/connectwise/v10` and `/connectwise/v1other`. The reviewed local Monotorr API route declarations contain no `/connectwise/v1` namespace; existing `/v1/...` routes remain on the fallback.

[Microsoft routing documentation](https://learn.microsoft.com/en-us/azure/container-apps/rule-based-routing-custom-domain) documents exact and slash-boundary prefix matching. [Environment routing permissions](https://learn.microsoft.com/en-us/azure/container-apps/rule-based-routing) are separate from app deployment permissions. Do not broaden the GitHub identity's environment Reader role: apply a separately reviewed narrow route change through an authorized operator. Inspect before/after rules and regression checks; do not apply a stale full-environment template.

Routing acceptance requires unchanged MCP metadata/challenge/SDK 39-tool inventory, unchanged known Monotorr route behavior, successful namespace targeting, boundary-negative tests, and an explicit reviewed rollback that removes only the added control rule. Merely disjoint path names do not prove deployed routing preservation.

## Approved portal placement — existing product preserved

Read-only inspection found `app.monotorr.com` bound to `monotorr-portal`. The owner explicitly rejected transferring/detaching it and approved `portal.monotorr.com` for `connectwise-portal` instead. Cloudflare hosts DNS; the owner added a DNS-only CNAME `portal` → `black-bush-04c7a8b0f.5.azurestaticapps.net`. The authorized Azure binding request is confined to the new ConnectWise portal. Its validation/TLS status must pass before live browser acceptance; `app` and `api` DNS/bindings remain unchanged.

## Microsoft identity and registration contract

Use a ConnectWise-specific application registration with business/organizational accounts across Entra tenants (`AzureADMultipleOrgs`), independently configured from Monotorr 365. The explicitly approved customer-login registration is **Monotorr** (originally created as Monotorr ConnectWise Customer Login), client ID `4405ef16-dc89-4385-8a84-cda2a52274cf`, object ID `ac582c04-b7d8-479a-b050-6ff4d32aa1a4`. Its home-tenant service principal is separate. Web callback is exact, implicit token issuance is disabled, and `requiredResourceAccess` is empty. No Monotorr 365 or Descope registration was changed. Request only OIDC `openid profile email`; no Microsoft Graph API, Microsoft 365 administration or admin-consent workflow. Customer tenant policy may still restrict ordinary application consent.

Use a maintained OIDC client library for code flow, PKCE, state/nonce validation and token response handling rather than copying the inherited Monotorr custom verifier. `openid-client` 6.8.8 was added; the implementation explicitly enables its JWS signature checks in addition to token response validation; default transport trust alone is insufficient for the intended signed-identity validation. Its required `jose` dependency advances the existing compatible 6.x lock to 6.2.12; MCP behavior must pass regression tests. `oauth4webapi` 3.8.8 is transitive. [Library signature validation](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md).

Validate the ID token signature against trusted Microsoft metadata/JWKS, allowed algorithm, audience for the registered application, nonce, expiry/time bounds and exact tenant-specific issuer. Organizational discovery has a tenant placeholder; validate the concrete issuer against `tid`, never substring-match or disable issuer validation. Reject consumer-account identities and malformed tenant/object IDs. Stable mapping uses provider + Entra tenant ID (`tid`) + object ID (`oid`); mutable email/display name is profile metadata only. Do not use an unverified token's URLs to choose a fetch target. [Microsoft multitenant issuer validation](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens).

Token material stays server-side and is discarded after verification/identity resolution. Portal authentication does not reuse the Descope MCP token or modify its policy. Store no Microsoft access/refresh/ID token. No portal refresh-token persistence is needed for an opaque Monotorr browser session.

Any confidential-client credential and browser-flow protection key required by the selected library/model must be provisioned securely in the product Key Vault with separate, reviewed secret-scoped runtime grants. Approved secret names are `cw-portal-oidc-client-secret` (90-day registration credential) and `cw-browser-flow-key` (32-byte random flow-protection key). Only the control API runtime identity receives Secrets User on these two individual secret scopes. The tested `scripts/deploy/provision-browser-auth.mjs` creates/transfers material in memory, refuses overwrite and revokes its new app credential on failed setup. Partial Vault writes require operator reconciliation, not an automatic retry. No values belong in repository files, commands, logs or GitHub artifacts.

## Browser session and CORS contract

- API-host-only cookie; **omit Domain**, never `.monotorr.com`.
- Distinct customer cookie name proposed: `__Secure-cw-customer-session`.
- Cookie `Path=/connectwise/v1`, `HttpOnly`, `Secure` in production, `SameSite=Lax`.
- A separate short-lived login-transaction cookie, if used, is scoped to `/connectwise/v1/auth`, with the same security attributes. The transaction cookie is authenticated/encrypted with A256GCM; its state hash is held in `auth_login_attempts`. Flow lifetime is ten minutes. State/nonce/PKCE are browser-bound, expiring and single-use; callback replay cannot recreate sessions/trials.
- Use `__Secure-`, not `__Host-`, because the narrow path deliberately differs from `/`.
- Random opaque session token, at least 256 bits; only its cryptographic hash is stored in `auth_sessions`. Fixed 24-hour expiry and explicit server-side revocation. Only SHA-256 hashes persist; no role snapshot is authoritative.
- Re-read user/account status and membership for each customer request. No admin role is implied by customer ownership or any email.
- Allow credentialed CORS **only** for `https://portal.monotorr.com`, with `Vary: Origin`; no wildcard, suffix match, Azure-generated-origin fallback or reflected arbitrary origin.
- Restrict methods/headers to the implemented slice routes. Reject foreign origins for customer mutation endpoints; logout is POST with explicit origin/CSRF protection. Microsoft navigation callback instead relies on state/nonce/PKCE and exact redirect validation.
- HTTPS `portal` and `api` are different origins but the same site. Credentialed fetch and exact-origin validation are still required. Cookie Path and CORS are not substitutes for account authorization or isolation from compromised sibling applications.
- No cookies/tokens, authorization codes, raw claims, email, account/customer data or request/response bodies in operational logs. Callback query strings must not enter application access logs; review deployed logging before live login.

## Account and entitlement behavior preserved by this design

Create/resolve one user, one account and owner membership transactionally and idempotently from the stable external mapping, including concurrent first login. Store acquisition independently from entitlement. Create exactly one account trial, lasting 30 × 24 hours in UTC server time; repeat login never extends it. Recognize the four architecture sources but implement only trial creation/evaluation now. Account status is available to authenticated customers even when their trial is expired, with explicit deny and no ConnectWise configuration lookup.

No admin console or admin customer auto-enrollment is introduced. If an admin-only identity has already been designated, reject that stable identity on customer signup. Otherwise no ordinary customer receives administration; designation remains a separate explicit decision, never an email exception.

## Implementation/deployment gate

Portal placement and separate registration decisions are resolved. Before applying the existing-router change, show the exact diff and use the approved in-Codex live-action gate. `scripts/deploy/customer-routing.mjs plan` records only nonsecret routing properties under ignored `.delivery/`; apply/rollback refuse live drift and preserve the existing domain/certificate, MCP rule and Monotorr fallback. GitHub's environment Reader permission is not broadened.

Use the existing manually triggered GitHub OIDC immutable build → private migration → candidate → smoke → promotion path. `prepare` supplies only the nonsecret customer client ID and `CW_CUSTOMER_FEATURES_ENABLED=true` to the new control API candidate. Disabled mode keeps Phase 0 behavior. Startup fails closed when enabled but registration/Key Vault settings are invalid. Customer secrets, database passwords and Microsoft tokens never enter CI.

Migration `0002_customer_foundation` adds the six account/session/entitlement tables plus `auth_login_attempts` for one-use flow consumption. Runtime receives required table/column privileges only; no schema, role, migration-ledger or entitlement-update privileges. The existing private migration CLI adds `--verify-slice1` for SELECT-only aggregate row counts/duration/hash-format evidence; no row IDs, profile fields, tokens or secrets are emitted. Remove the verification argument before the next normal migration execution.

No admin-only identity is designated. The owner explicitly approved proceeding without one: no admin routes or permissions exist, and every customer, including the product owner, follows the same identity/account/trial/session rules. Do not create or require an admin identity in this slice.

Slice 1 remains incomplete until focused/full PostgreSQL 18 validation, immutable deployment, real browser login/logout/re-login evidence, account isolation, unchanged MCP inventory and owner dogfood all pass. No ConnectWise customer configuration, Descope linkage or later product functionality is implemented.


## Slice 1 checkpoint — 2026-10-10

Local validation passed: 495 tests across 24 files with real disposable PostgreSQL 18 integration enabled; UI, backend and portal builds; self-contained ticket-card validation; lint; production/full audits (zero vulnerabilities); diff checks. Real integration verifies four concurrent first logins resolve one account/trial, repeat login and email update preserve account/trial, a second immutable identity resolves a separate account, foreign account context is denied, session hashes/expiry/revocation hold, and runtime cannot perform migration/admin or entitlement-update operations.

Live setup completed with explicit owner authorization: separate organizational-account registration and home-tenant enterprise application; browser-only credential/flow-key provisioning in memory into the product vault; two secret-specific runtime read grants; owner-created Cloudflare DNS-only portal CNAME; ConnectWise portal domain status Ready and HTTPS smoke passed. `app.monotorr.com` remains with the Monotorr 365 portal. Existing MCP anonymous smoke passed; its application/configuration/credentials/tools were not changed. Existing GitHub production environment has only the branch policy, with no duplicate required-reviewer gate.

Deployment completed after explicit owner approval:

- Source: `d15ca5078608573b75ac7138a358a095f133d839` (customer foundation), followed by `6f01e1d29881212e736472b7610dd1c6d64cd8ab` (bounded candidate-label prompt correction).
- Corrected immutable build: GitHub run `38066326435`, successful. ACR digest independently matched retained build evidence: `sha256:dd5a4c703a3cb27285a9f461b7a0b07fb4e9b3325caf3c0c65595c232053f47c`.
- Private migration/candidate: run `38066871246`, successful; execution `connectwise-migrate-vhvexbq` succeeded. No bootstrap rerun or direct operator database connection.
- Promotion: run `38067200382`, successful. Healthy revision `connectwise-control-api--p0-6f01e1d29881` serves 100%; prior `connectwise-control-api--p0-3ca2f48d87d8` remains healthy at 0%.
- The additive `/connectwise/v1` routing rule was applied and read back exactly. Existing MCP rule, Monotorr fallback and domain/certificate properties were preserved. `/health` remained 200; `/connectwise/v10` and `/connectwise/v1other` remained 404.
- Portal-only run `38067395214` succeeded. Permanent portal smoke and deployed customer UI asset checks passed. Both `portal.monotorr.com` and the preserved `app.monotorr.com` bindings remain Ready.
- Canonical customer smoke passed: anonymous account access 401, exact portal CORS and Microsoft login initiation with the approved callback/PKCE.
- Authenticated MCP SDK regression passed: approved identity, initialize, protocol `2025-11-25`, tools/list, exact 39-tool set. Owner reported production ChatGPT's existing MCP connection connected and responding.
- MCP remains `connectwise-mcp-pilot--0000005`, Single revision mode, 100% traffic, immutable digest `sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`. Its configuration, credentials and tools were not changed.

Delivery correction: before migration/candidate preparation, Azure CLI behavior showed moving an existing `candidate` label could prompt for confirmation. The tested correction adds `--yes` only to that explicitly approved label movement. It does not change revision mode, promotion order, permissions, candidate contents or MCP. The corrected source was rebuilt through the normal immutable workflow before deployment; the earlier build was never deployed.

## Final Slice 1 acceptance — 2026-10-10

The owner confirmed login/logout works for both test business identities and that opening the authenticated account endpoint after logout returns `{"error":"unauthorized"}`. The deployed handler returns HTTP 401 for that result. The first customer's status screen shows an active trial, ConnectWise Not configured, and Next action: Connect ConnectWise. No customer credentials were collected and no administrative privilege was granted.

### Read-only database evidence

Evidence was collected inside the existing healthy control API container, using the existing `databasePool(process.env)`, managed identity/Key Vault database connection and runtime DB role. Every diagnostic query ran in `BEGIN READ ONLY` with a ten-second statement timeout; transactions committed without writes and connections were closed. No migration-job arguments, schema, grants, passwords, Azure configuration or MCP settings were changed during this acceptance pass.

| Test customer | Internal user ID | Account ID | Trial ID |
| --- | --- | --- | --- |
| First | `ae54acc4-31f7-436d-be29-3f17645e87d2` | `1509be5b-f14d-49cb-b530-e29aaff95f40` | `23cc74de-2272-4535-adf0-bba665287220` |
| Second | `697d9d39-66b0-41af-8b3b-7b7e6267a1ea` | `ecce764e-4740-4398-ab00-d96ba494faf1` | `7c2467d8-077b-4d30-a095-4353a59fd102` |

Each customer has exactly one membership, one Microsoft external identity and one trial. Total row counts: users **2**, accounts **2**, account_memberships **2**, external_identities **2**, entitlements **2**. Thus logout/re-login created no duplicate customer, account, membership, identity or entitlement rows.

The first customer's trial remains `2026-10-10T16:27:57.011Z` → `2026-11-09T16:27:57.011Z`; its internal user/account/trial IDs match the pre-test baseline. The second customer's separate trial is `2026-10-10T16:46:03.510Z` → `2026-11-09T16:46:03.510Z`. Both intervals are exactly 30 days. The observed revoked-session counts were first **2**, second **1**; session hashes and cookie values were never queried or printed.

Test-identity labels were correlated from the supplied profile emails solely for acceptance reporting. Email was not used for authentication or authorization; production mapping remains the stable Microsoft tenant/object identity. No profile emails, provider tokens, session cookies/hashes or API credentials are recorded in this evidence.

### Isolation and logout verification

The existing compiled production `CustomerStore.status` was invoked through the same read-only DB transaction: first-user/second-account and second-user/first-account contexts both failed closed; each customer's own context succeeded. This verifies the deployed ownership SQL, not a substitute or copied implementation. HTTP foreign-account query/header rejection and session replay behavior are covered by the passing regression tests; an authenticated live HTTP foreign-ID/replayed-cookie test was not completed in this acceptance pass.

The separate automated browser run did not pass its first-identity check and is not counted as acceptance evidence. Live browser acceptance instead uses the owner's explicit confirmations, together with independent revoked-session and idempotent database evidence. The temporary browser was closed without exporting tokens, cookies, browser storage or screenshots.

### MCP preservation

Fresh anonymous health/metadata/challenge smoke passed. Read-only Azure inspection confirmed unchanged MCP revision `connectwise-mcp-pilot--0000005`, Single mode, 100% traffic and digest `sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`. The authenticated SDK inventory captured during this same Slice 1 delivery passed initialize/tools/list and the exact **39 read-only / 0 write** set. Owner production ChatGPT dogfood reported the existing MCP connected and responding. No MCP app, routing rule, auth policy, credentials or tool registration was changed.

### Consent metadata and pre-launch items

At the owner's isolated request, the app registration and home-tenant enterprise application's display names were renamed to **Monotorr**. Client ID, account type, callback, credentials, permissions and publisher settings were verified unchanged. Publisher verification and removing the unverified label remain **pre-launch requirements**, along with accurate privacy/terms links on consent. They do not block Slice 1 acceptance. Do not request additional Microsoft Graph API permissions for login.

Microsoft documents that the offline-access consent description can appear without requesting refresh tokens ([scope documentation](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)). This flow requests only `openid profile email` and discards provider tokens after verified identity resolution. Console-log sampling found no token/authorization/callback markers but no application events; this sample alone is not proof that every platform logging destination is clean.

### Operator diagnostic deviations and cleanup

The earlier migration-job argument diagnostic did not start an execution; its temporary argument change was restored and verified. During the final acceptance pass, Azure exec first rejected command quoting and later rejected an oversized combined command at the WebSocket transport. Shorter transport-safe read-only commands succeeded. No architecture, application or permission change was needed. The migration job retains `node dist/database/cli.js` throughout final acceptance.

**Slice 1 PASS.** The only repository closeout changes are this document and `V1_AZURE_DELIVERY_RUNBOOK.md`. No Slice 2 functionality, commit or deployment is authorized by this acceptance report.
