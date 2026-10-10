# Phase 1 Slice 1 — customer browser authentication design

Status: Slice 1 repository implementation in progress; live acceptance pending. The owner resolved portal placement to `portal.monotorr.com` and approved a separate business-account Entra registration. No Slice 1 PASS claim is made.

Scope: Microsoft business login → internal user → one customer account → one 30-day trial → account-status screen → logout. Scope authority remains [V1 architecture](V1_PRODUCT_ARCHITECTURE.md) and [implementation plan](V1_IMPLEMENTATION_PLAN.md). This slice does not change MCP, link Descope identities, collect ConnectWise credentials or implement later entitlement acquisition paths.

## Approved permanent origins

- Customer portal: `https://portal.monotorr.com`.
- Control API origin: `https://api.monotorr.com`.
- MCP remains `https://api.monotorr.com/mcp`.
- Do not create another control API hostname. Azure-generated app FQDNs remain deployment/candidate verification targets, not customer authentication URLs.

## Proposed namespace and browser routes

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

Use a ConnectWise-specific application registration with business/organizational accounts across Entra tenants (`AzureADMultipleOrgs`), independently configured from Monotorr 365. The explicitly approved registration is **Monotorr ConnectWise Customer Login**, client ID `4405ef16-dc89-4385-8a84-cda2a52274cf`, object ID `ac582c04-b7d8-479a-b050-6ff4d32aa1a4`. Its home-tenant service principal is separate. Web callback is exact, implicit token issuance is disabled, and `requiredResourceAccess` is empty. No Monotorr 365 or Descope registration was changed. Request only OIDC `openid profile email`; no Microsoft Graph API, Microsoft 365 administration or admin-consent workflow. Customer tenant policy may still restrict ordinary application consent.

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

Local validation passed: 494 tests across 24 files with real disposable PostgreSQL 18 integration enabled; UI, backend and portal builds; self-contained ticket-card validation; lint; production/full audits (zero vulnerabilities); diff checks. Real integration verifies four concurrent first logins resolve one account/trial, repeat login and email update preserve account/trial, a second immutable identity resolves a separate account, foreign account context is denied, session hashes/expiry/revocation hold, and runtime cannot perform migration/admin or entitlement-update operations.

Live setup completed with explicit owner authorization: separate organizational-account registration and home-tenant enterprise application; browser-only credential/flow-key provisioning in memory into the product vault; two secret-specific runtime read grants; owner-created Cloudflare DNS-only portal CNAME; ConnectWise portal domain status Ready and HTTPS smoke passed. `app.monotorr.com` remains with the Monotorr 365 portal. Existing MCP anonymous smoke passed; its application/configuration/credentials/tools were not changed. Existing GitHub production environment has only the branch policy, with no duplicate required-reviewer gate.

Not completed yet: source commit/push, OIDC immutable image publication, private production migration, auth-enabled control API candidate/promotion, additive API route application, new portal publication, real Microsoft browser login/logout/re-login, production aggregate database evidence, authenticated MCP inventory/owner dogfood. Slice 1 is not PASS at this checkpoint.
