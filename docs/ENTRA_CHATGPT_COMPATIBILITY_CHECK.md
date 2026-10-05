# Entra / ChatGPT MCP Compatibility Check

> **Completed gate, 2026-10-04:** the user tested actual tenant discovery: `code_challenge_methods_supported: null`, so direct Entra **FAIL**. Conditional direct-Entra checks below are historical. Descope now supplies genuine S256 discovery/MCP authorization; Entra SAML supplies identity. See [current Descope implementation/live-test plan](CHATGPT_DESCOPE_MCP_LIVE_TEST.md). Upstream SAML/JIT login passed; ChatGPT registration/exchange, real MCP claims/audience/scope, refresh and public Azure deployment have not yet passed.

Research date: 2026-10-04. Design only. Canonical repository: `/Users/rleon/Development/connectwise-mcp`. This document supplements [the authentication design](CHATGPT_ENTRA_AUTHENTICATION_DESIGN.md) and [Phase 1 hardening](PHASE1_HARDENING.md).

**Conclusion: direct Entra is a candidate, not a verified compatible configuration.** Entra supports the underlying code flow and Microsoft now documents MCP resource indicators. However, the public Entra discovery document inspected here omits the PKCE capability required by ChatGPT. The actual tenant and ChatGPT's fixed-client exchange must pass the checks below before authentication implementation or public deployment is approved.

No tenant GUID, application registrations, tenant policies, or live ChatGPT connection were inspected. No application code, configuration, secrets, resources, or existing documents were changed. Manual checks below are instructions for subsequent verification, not completed tests.

## Requirements and Compatibility

OpenAI specifies OAuth 2.1, code flow with S256, predefined clients as an option, and validation on each MCP request. Its CIMD methods are `none` and `private_key_jwt`; those are not evidence of the methods supported for a separately preregistered Entra client. [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

The MCP authorization specification uses a selected OAuth 2.1 feature set; ordinary OAuth/OIDC login success alone does not establish compliance. In particular, missing `code_challenge_methods_supported` must cause a client to stop, even if PKCE works at runtime. [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

| Item | Required contract / proposed choice | Entra assessment |
| --- | --- | --- |
| Code flow | `response_type=code`, state validation, HTTPS callback; no implicit/password/client-credentials substitute | Supported underlying flow. |
| PKCE | S256 challenge and corresponding verifier, with S256 advertised in discovery | Runtime support documented; advertisement is an unresolved blocking gate. |
| Protected-resource metadata (PRM) | Public JSON identifying our resource and the exact Entra issuer | Our MCP service must supply it; absent from the active handler today. |
| AS discovery | OIDC discovery or RFC 8414 metadata, with consistent issuer and endpoints | Entra has OIDC discovery; validate the tenant-specific response, not `common`/`organizations`. |
| Client registration | Use a preregistered client GUID | Documented alternative to DCR. ChatGPT configuration and exchange remain live checks. |
| CIMD | URL-valued client identity, fetched metadata, advertised capability | No verified native Entra support found; public discovery does not advertise it. Do not assume supported. |
| DCR | RFC 7591 `registration_endpoint` if that path is selected | Microsoft explicitly says Entra does not support DCR. Portal app creation is not DCR. |
| Resource indicator | Exact `https://api.monotorr.com/mcp` on authorization and token requests | Microsoft documents mapping to an identical API Application ID URI and scopes for that same API. |
| Audience | Token must be issued specifically for our MCP API | Entra v2 `aud` is the resource application's GUID, not the literal MCP URL. Validate that GUID only. |
| Scopes | Proposed full scope `https://api.monotorr.com/mcp/connectwise.read` | Define on the MCP API; enforce short token `scp` value `connectwise.read`. |
| Persistence | Request `offline_access`; support refresh and eventual interactive reauthorization | Supported by Entra; ChatGPT's issuance/use/replacement must be tested. |
| Challenges | Bearer discovery and safe auth errors | Our handler needs standards-based responses before it is ChatGPT-ready. |
| Tool declarations | All 39 tools require OAuth, including the compatibility metadata mirror | Server work; descriptors do not enforce access by themselves. |
| Every request | Verify token and approved-user policy before resolving ConnectWise configuration | Use the existing fail-closed boundary; a session ID or console cookie cannot bypass it. |

Entra documents authorization-code exchange with PKCE and confidential Web client authentication, including a secret or certificate. S256 protects code redemption in addition to client authentication. [Entra code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [PKCE standard](https://www.rfc-editor.org/rfc/rfc7636.html).

Microsoft's MCP instructions require v2 API tokens first, then the matching HTTPS Application ID URI; inconsistent resource/scope mapping can produce `AADSTS9010010`. This avoids inventing a proxy that drops `resource`. [Entra MCP guidance](https://learn.microsoft.com/en-us/entra/agent-id/secure-mcp-server-with-entra-id). Resource URLs can map to an abstract audience identifier; URL equality with the JWT `aud` is not universally required. [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html).

### Discovery observation and client authentication

The public [organizations discovery document](https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration), fetched on the research date, advertises:

- `client_secret_post`, `private_key_jwt`, `client_secret_basic`, `self_signed_tls_client_auth`.
- `openid`, `profile`, `email`, `offline_access`.
- A placeholder issuer `https://login.microsoftonline.com/{tenantid}/v2.0`.
- **No** `code_challenge_methods_supported`, `registration_endpoint`, `client_id_metadata_document_supported`, or `authorization_response_iss_parameter_supported`.

This is a reproducible observation of a generic endpoint, not proof about every tenant or a runtime token exchange. It fails the advertised-PKCE gate. Do not configure this placeholder issuer for Phase 1.

Microsoft explicitly recommends preregistration where Entra lacks DCR. [App Service MCP authorization](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-mcp). Our preferred candidate is a dedicated confidential Web client registered for ChatGPT, using a secret-based method that both sides demonstrably support. No secret is created in this design step. Later, any client secret belongs in ChatGPT's supported OAuth configuration and its controlled credential lifecycle; it is separate from ConnectWise keys.

Entra accepting `private_key_jwt` does not prove it can fetch OpenAI CIMD/JWKS or use OpenAI's managed signing keys for our fixed registration. Do not assume that CIMD method negotiation applies to fixed clients. Do not silently fall back to a public client: refresh-token replay protection needs separate assessment if that becomes necessary.

### Callback and issuer handling

Copy the exact callback from the actual ChatGPT connection management page. Current callback modes are `https://chatgpt.com/connector/oauth/{callback_id}` and, for eligible providers or retained older connections, `https://chatgpt.com/connector_platform_oauth_redirect`. Do not guess which this connection receives or allow wildcards. [OpenAI callback guidance](https://developers.openai.com/plugins/changelog).

Stable-callback eligibility depends on truthful RFC 9207 capability advertisement and matching `iss` in successful and error authorization responses. This callback issuer check is distinct from checking JWT `iss` at `/mcp`. [RFC 9207](https://www.rfc-editor.org/rfc/rfc9207.html). Metadata issuer consistency and endpoint/client-auth declarations follow [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html).

### Persistent connection and permissions

Use the API read scope plus `offline_access`, allowing OIDC `openid profile email` as requested by ChatGPT. These login scopes do not require Microsoft 365 administration, Microsoft Graph data permissions such as `User.Read`, or Graph calls by our service. Entra's discovery lists a Graph-hosted UserInfo endpoint; that fact alone does not create a need to call it. Handle absent email claims. [Entra scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc).

ChatGPT, as OAuth client, must retain and use refresh tokens; our resource server should not collect or persist them. Entra returns replacement refresh tokens but does not automatically invalidate the old token on use. SPA callbacks have a 24-hour refresh lifetime; use the appropriate Web callback registration. Other lifetime defaults do not promise indefinite access: revocation and tenant policy can require another browser authorization. [Entra refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

The desired experience is feasible in principle: link once, close the configuration console, and continue using ChatGPT through refresh. It is not a promise never to reauthenticate. Console-session expiration must not terminate an independently valid MCP grant.

## Two Independent Application Flows

| | A. Configuration web console | B. ChatGPT MCP authorization |
| --- | --- | --- |
| OAuth client | Dedicated console registration and its own callback | Dedicated preregistered ChatGPT client and exact OpenAI callback |
| Purpose | User signs in to configure stored ConnectWise credentials | User authorizes ChatGPT to query the MCP API |
| Browser/session | Console owns its login/session and configuration authorization | ChatGPT owns its connection/access/refresh-token lifecycle |
| Access policy | Explicit configuration administrator policy | Read scope plus approved-user policy |
| MCP credential | Console session is not accepted at `/mcp` | Bearer access token with MCP API audience |

Both can use the same Entra tenant and accounts. They must have separate callbacks, credentials, session semantics, and authorization policies. The console is a future flow; do not build it to solve ChatGPT linking. The MCP API needs its own resource registration, distinct from Monotorr and the two client registrations. Initially only the API and ChatGPT client are needed; add the console client when that console exists.

Recommended MCP staff policy: a user-assignable `CWM.Read` role on the API, assigned directly to the initial approved employee, and mandatory delegated read scope. A scope expresses the client's permission; role assignment approves the user. Groups can later be assigned to that role without introducing Graph group-overage lookups. [Entra app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps).

Proposed verifier allowlist: exact tenant issuer, tenant GUID, API audience GUID, ChatGPT client GUID (`azp`), token version 2, delegated scope and role; verify signature, approved signing algorithm, expiry and not-before. Use immutable tenant/object IDs rather than email/domain. Single-tenant issuance alone does not exclude invited guests; only explicitly approved users are allowed. Reject console/Monotorr/Graph audiences, ID tokens, and application-only tokens lacking the delegated scope. [Entra token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference).

ConnectWise authentication remains fixed and independent: an administrator creates the dedicated API user/member, assigns the documented read-only security role, obtains public/private keys, and enters server URL, Company ID, Public Key, Private Key and Client ID into the setup application. Our service securely stores those values and uses them downstream. MCP callers never supply them; Entra tokens are never forwarded to ConnectWise. This document does not verify or change ConnectWise permissions.

## Endpoints and Proposed Flow

`T` is the real tenant GUID, `A` the MCP API application GUID, and `C` the ChatGPT OAuth client GUID. None is known from this review.

| Owner | Endpoint | Purpose |
| --- | --- | --- |
| MCP service | `https://api.monotorr.com/mcp` | Protected MCP transport |
| MCP service | `https://api.monotorr.com/.well-known/oauth-protected-resource/mcp` | Public path-qualified PRM |
| MCP service, optional | `https://api.monotorr.com/.well-known/oauth-protected-resource` | Standard root alternative; only if it does not conflict with another resource |
| Entra | `https://login.microsoftonline.com/T/v2.0/.well-known/openid-configuration` | OIDC discovery for the tenant issuer |
| Entra | `https://login.microsoftonline.com/T/oauth2/v2.0/authorize` | Browser authorization |
| Entra | `https://login.microsoftonline.com/T/oauth2/v2.0/token` | Code exchange and refresh |
| Entra | HTTPS `jwks_uri` returned by verified discovery | Public signing keys |
| ChatGPT | Exact callback shown for the connection | Receives code; not a route we host |

The path-qualified PRM is a standard option and should be advertised in the challenge. [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html). Direct Entra requires no local authorization-server metadata, `/authorize`, `/token`, `/register`, or invented OAuth endpoint.

Proposed PRM (replace `T`, never publish the placeholder):

```json
{
  "resource": "https://api.monotorr.com/mcp",
  "authorization_servers": ["https://login.microsoftonline.com/T/v2.0"],
  "scopes_supported": ["https://api.monotorr.com/mcp/connectwise.read"],
  "bearer_methods_supported": ["header"]
}
```

```mermaid
sequenceDiagram
    actor U as User
    participant G as ChatGPT
    participant M as api.monotorr.com MCP service
    participant E as Tenant-specific Entra
    participant W as ConnectWise Manage
    U->>G: Add https://api.monotorr.com/mcp
    G->>M: MCP request without token
    M-->>G: 401 Bearer challenge pointing to PRM
    G->>M: GET /.well-known/oauth-protected-resource/mcp
    M-->>G: Resource, Entra issuer, read scope
    G->>E: GET /T/v2.0/.well-known/openid-configuration
    E-->>G: Endpoints and capabilities
    Note over G,E: Stop unless S256 discovery and fixed-client gates pass
    G->>U: Open browser authorization
    U->>E: /T/oauth2/v2.0/authorize: C, code, S256, state, resource, scopes
    E-->>G: Code and state at exact registered ChatGPT callback
    G->>E: /T/oauth2/v2.0/token: code, verifier, resource, client authentication
    E-->>G: MCP API access token and refresh token if granted
    G->>M: /mcp with Bearer access token
    M->>M: Validate signature, issuer, A, time, T, C, scope, approved user
    M->>M: Resolve service-owned ConnectWise configuration
    M->>W: Read-only query using stored ConnectWise credentials
    W-->>G: Result through MCP service
    Note over G,E: ChatGPT refreshes at token endpoint; console need not remain open
```

Missing/invalid tokens need safe Bearer challenges with `resource_metadata`; invalid tokens use 401, insufficient scope uses 403 and `insufficient_scope`. Never return token material in descriptions. [Bearer error semantics](https://www.rfc-editor.org/rfc/rfc6750.html).

Tool descriptors should declare `securitySchemes: [{type: "oauth2", scopes: ["https://api.monotorr.com/mcp/connectwise.read"]}]` with matching `_meta.securitySchemes`. Tool-level reauthorization can use an error result with `_meta["mcp/www_authenticate"]`; neither replaces the HTTP gate. Actual wire serialization and ChatGPT recovery must be verified. [OpenAI tool reference](https://developers.openai.com/plugins/reference).

## Exact Manual Verification Plan

**Run only read-only tenant checks now.** If dedicated registrations do not exist, record **NOT TESTED**; do not create them in this research step. Later registration, deployment, and live tests require their own authorized implementation step. Unknown is not PASS.

### Read-only discovery commands

Run from the canonical repository. Requires `curl` and `jq`; installs nothing and writes no files. Set `CW_MCP_TENANT_ID` to the actual GUID from Entra Overview; it is not a secret.

```sh
set -o pipefail
CW_MCP_TENANT_ID='<actual-tenant-guid>'
curl --fail --silent --show-error \
  "https://login.microsoftonline.com/${CW_MCP_TENANT_ID}/v2.0/.well-known/openid-configuration" |
  jq '{issuer, authorization_endpoint, token_endpoint, jwks_uri,
       response_types_supported, code_challenge_methods_supported,
       token_endpoint_auth_methods_supported, scopes_supported,
       registration_endpoint, client_id_metadata_document_supported,
       authorization_response_iss_parameter_supported}'
```

Blocking PKCE predicate; exit zero is PASS, nonzero is FAIL:

```sh
curl --fail --silent --show-error \
  "https://login.microsoftonline.com/${CW_MCP_TENANT_ID}/v2.0/.well-known/openid-configuration" |
  jq -e '(.code_challenge_methods_supported // []) | index("S256") != null'
```

| Check | URL / command or exact portal location | Inspect | PASS | FAIL |
| --- | --- | --- | --- | --- |
| T1 Tenant identity | `https://entra.microsoft.com` → Entra ID → Overview | Tenant ID and intended employee's tenant | Record correct GUID `T` | Wrong tenant or identity unavailable |
| T2 Issuer/discovery | First command above | `issuer`, authorize/token URLs, code response type | Exact issuer `https://login.microsoftonline.com/T/v2.0`, tenant endpoints, `code` | Placeholder/wrong issuer, missing endpoints/code, HTTP failure |
| T3 Advertised PKCE | Second command above | `code_challenge_methods_supported` | Contains `S256` | Absent, null, missing S256: stop direct design |
| T4 Signing keys | `curl --fail --silent --show-error '<jwks_uri-from-T2>'` | Public `keys`, `kid`, RSA signing material | Valid HTTPS JWKS; later token key resolves | Unreachable/invalid keys or untrusted destination |
| T5 Token client methods | T2 response | `token_endpoint_auth_methods_supported` | Contains method also supported by actual ChatGPT fixed-client configuration | No compatible method; Entra-only support is insufficient |
| T6 Registration capabilities | T2 response | CIMD flag / `registration_endpoint` | Fixed-client route selected; absence is acceptable on that route | Reliance on unadvertised CIMD or unavailable DCR |
| T7 Callback mode | T2 response; ChatGPT management page at `https://chatgpt.com` | RFC 9207 flag and exact callback | Connection-specific URI recorded; stable mode only if truthfully supported | Guessed callback or false issuer-support assumption |
| T8 API identity | Entra → App registrations → MCP API → Overview / Manifest | `appId=A`, `signInAudience`, `api.requestedAccessTokenVersion` | Separate API; `AzureADMyOrg`; version 2 | Reused Monotorr app, broad tenant type, wrong version |
| T9 Resource/scope | API → Expose an API / Manifest | `identifierUris`, enabled delegated scope | Exact MCP URL, no trailing slash; full proposed read scope | Mismatch or scope on another API |
| T10 Approved staff | API → App roles; Enterprise applications → API → Users and groups / Properties | User role, assignments, assignment requirement | `CWM.Read` allows Users; initial employee explicitly assigned; assignment required as defense in depth | Broad/default access, application-only role substituted, unapproved assignment |
| T11 ChatGPT client | App registrations → dedicated client → Overview / Authentication | GUID `C`, tenant audience, `web.redirectUris`, implicit/public options | Single tenant, exact ChatGPT Web callback; implicit/public fallback disabled | SPA/wildcard/wrong callback, unrelated shared client, unintended public flow |
| T12 Client permission | Client → API permissions; API → Expose an API → Authorized client applications | Delegated API read permission and consent/preauthorization | Only required read grant and login scopes; consent approved | Graph/M365 data/admin permissions, write grants, missing required consent |
| T13 Credential lifecycle | Client → Certificates & secrets (metadata only); ChatGPT OAuth configuration | Compatible method, validity dates, ownership/rotation plan | Controlled valid credential configured through supported client flow later | Expired/mismatched credential or no safe rotation path |
| T14 Tenant policy | Entra → Protection → Conditional Access; Monitoring → Sign-in logs | Policies applying to these apps/user; sanitized failure codes | MFA/browser login works and refresh policy acceptable | Policy prevents code redemption/refresh or requires unacceptable login frequency |

No Microsoft Graph CLI permission or Graph API query is needed for these checks. Portal administration to configure an application is separate from runtime permissions granted to it. Do not inspect/copy secret values or save authorization headers, codes, raw tokens or unredacted traces into this repository.

### Checks after a separately authorized test implementation

| Check | URL / command or test location | Inspect | PASS | FAIL |
| --- | --- | --- | --- | --- |
| L1 Public PRM | `curl --fail --silent --show-error https://api.monotorr.com/.well-known/oauth-protected-resource/mcp` | JSON fields, TLS, HTTP status | 200 without login; exact resource, tenant issuer and read scope | Redirect/login wall, wrong fields, TLS failure |
| L2 Missing-token challenge | `curl -i -X POST https://api.monotorr.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"auth-check","version":"1"}}}'` | Status and `WWW-Authenticate` | 401 with Bearer PRM pointer; no secret lookup/tool execution | Anonymous success, bare 401, HTML login redirect or CW activity |
| L3 Fixed-client discovery | `https://chatgpt.com` → connection/plugin management → add planned MCP URL | Client configuration, discovery result, exact redirect URI | ChatGPT accepts GUID `C`, supported client auth, authentic discovery | Requires unavailable CIMD/DCR, rejects S256 metadata or client method |
| L4 Code/resource exchange | Actual ChatGPT link; Entra sign-in logs plus sanitized test instrumentation | S256, verifier outcome, resource on both requests, requested scope, client-auth method | Code redemption succeeds for matching resource/API | `invalid_client`, `AADSTS9010010`, missing resource/PKCE or failed exchange |
| L5 Verified access token | Authenticated `/mcp` test validator, locally inspected claims only | Signature/time, `iss`, `tid`, `aud`, `ver`, `azp`, `scp`, `roles`, user `oid` | Expected T/A/C, v2, read scope, approved role/user | Wrong identity/audience/client, invalid signature/time, missing permission |
| L6 Tool discovery/execution | ChatGPT connection: `tools/list` then harmless read call | Actual OAuth descriptor fields; tool list; result | 39 read tools available, 16 writes absent; approved user can read | Lost read tools, write capability, malformed auth metadata or failed tool linking |
| L7 Persistent connection | Same ChatGPT link after access expiry; close console session first | Refresh grant/result and later read call | Continued access without console login; refreshed token remains correctly bound | Repeat login each expiry, no refresh, console session dependency |
| L8 Negative authorization | Authorized isolated test client at `/mcp`; test invalid/expired/wrong-audience/tenant/client tokens and a same-tenant unassigned user | Sanitized status/error; mocked CW/provider call counters | 401 invalid credentials; 403 insufficient authorization; zero CW/config access | Any unauthorized execution or exposed sensitive diagnostic |
| L9 Recovery/revocation | ChatGPT reconnect after an authorized test-account revocation or role removal | Expired-link challenge, new-token policy, denial interval | Controlled reauthorization; revoked/removed access denied within documented policy | Silent continued access beyond agreed interval or unusable relink |

L8 must include initialization, tool listing, and calls on fresh and reused transport requests. Token validation does not inherently provide immediate role revocation: an already issued JWT may retain its claims until expiry. Define an acceptable interval or an explicit local user-deny policy before declaring L9 PASS. Do not promise instantaneous revocation from per-request signature checks alone.

OpenAI's connection testing instructions support testing the actual ChatGPT host rather than substituting another MCP client. Workspace/plan permissions may determine whether the relevant connection controls are available. [Connect and test](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## What We Know Works

Entra documents code flow, runtime PKCE, tenant OIDC discovery, delegated API permissions, user roles and refresh. Microsoft documents native resource-to-API mapping. OpenAI documents a predefined-client option; lack of DCR alone is not a disqualifier. These are component capabilities, not an end-to-end PASS for our tenant.

Our current handler authenticates before configuration resolution and MCP execution. The shipped production HTTP entry point has no authenticator and fails closed. Nothing in this review enables it.

## What Requires Our Entra Tenant

T1–T14 require the actual tenant metadata, app settings and policies. The immediate blocker check is T3; run it before creating registrations. Existing tenant/publisher infrastructure does not repair missing discovery fields, authorize employees automatically, or replace dedicated registrations. Resource URI/domain acceptance and actual consent/assignment behavior also require tenant verification.

## What Requires Live ChatGPT Testing

L3–L7 and L9 require the real ChatGPT connection: fixed GUID/credential handling, callback selection, discovery acceptance, resource and scope transmission, GUID-audience compatibility, refresh persistence and relinking. Another client or successful console login cannot prove these. L1/L2/L8 can also be exercised independently against an isolated authenticated test implementation.

The configuration-console browser can be closed throughout the persistence test. No elevated Microsoft 365 permissions or ConnectWise credential input through ChatGPT should appear anywhere in linking.

## PASS / FAIL Criteria

- **Direct-Entra compatibility PASS:** actual tenant advertises S256 and valid discovery; ChatGPT supports the fixed confidential client/method and exact callback; code/resource exchange and refresh succeed with tokens for our API.
- **Security/deployment PASS:** additionally enforce approved-user policy and every-request validation; negative tests deny before secrets/tool execution; read-only inventory, safe challenges/logging and acceptable revocation behavior pass.
- **FAIL:** missing advertised S256, unavailable fixed-client method, incompatible resource/audience exchange, ineffective staff restrictions, or missing refresh for the required persistent experience. A working browser login cannot waive these failures.
- **NOT TESTED:** registrations, policies or endpoint unavailable. It does not qualify as PASS. Public generic discovery currently fails the PKCE advertisement check; our tenant status remains unknown.

## Recommended Authentication Architecture

Conditionally use direct single-tenant Entra with a dedicated MCP resource app and a separate preregistered confidential ChatGPT client. Add an independent console client later. Keep Monotorr application registrations, sessions and data separate; reuse only the tenant/identity infrastructure.

At the existing `createHttpHandler({ authenticate, configProvider, allowedOrigins })` boundary, a future implementation must validate bearer tokens and approved staff, produce typed 401/403 failures and safe challenges, and retain authentication before `configProvider`. Serve static public PRM outside the execution gate; preserve origin protections and the rejection of caller-supplied CW credentials. Supply the verifier explicitly at startup, add tool OAuth descriptors and request-local identity, and test wire output. Keep inherited local OAuth proxy/DCR routes unmounted. These are required future changes, not implemented here.

Use established JWT verification with Entra discovery/JWKS rather than a custom OAuth server. App Service authentication is a possible platform validator, but its MCP metadata feature is preview and does not prove S256/client compatibility or eliminate application staff-policy enforcement. Do not trust client-supplied identity headers or expose an unprotected backend if platform validation is chosen.

If direct compatibility fails, stop and separately evaluate an established MCP-compatible authorization broker federated to Entra. Do not fabricate Entra metadata, change its issuer, strip resource parameters, or revive the inherited simulated authorization server. Future Copilot can use a separate client after product-specific verification; commercial multi-tenancy requires its own onboarding and data-isolation design.

## Go / No-Go

**GO for read-only tenant verification. NO-GO for claiming direct Entra + ChatGPT compatibility, implementing the final authentication architecture, or enabling public production HTTP yet.** The observed discovery omission is a concrete standards gate, and fixed-client exchange/refresh remain untested. Proceed with direct Entra only after the tenant and live compatibility gates pass; otherwise revisit the authorization-server choice without weakening fail-closed behavior.
