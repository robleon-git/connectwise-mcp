# ChatGPT / Descope MCP live test

Implementation date: 2026-10-04. Canonical repository: `/Users/rleon/Development/connectwise-mcp`, branch `phase1-hardening`. No deployment, Azure resources, Entra/Descope mutation, secret retrieval or OAuth grant was performed during implementation. This runbook describes the next separately authorized deployment/test.

## Implemented resource-server flow

```mermaid
sequenceDiagram
    actor U as rob@monotorr.com
    participant G as ChatGPT
    participant M as Azure MCP resource server
    participant D as Descope authorization server
    participant E as Entra SAML identity provider
    participant C as ConnectWise
    G->>M: POST /mcp without token
    M-->>G: 401 Bearer resource_metadata challenge
    G->>M: GET /.well-known/oauth-protected-resource/mcp
    M-->>G: Exact resource, Descope issuer, connectwise.read
    G->>D: Discover AS and register/identify client
    U->>D: Browser authorization with S256 and resource
    D->>E: Monotorr SAML sign-in
    E-->>D: Validated federation response
    U->>D: Approve read scope
    D-->>G: Code at exact ChatGPT callback
    G->>D: Code, verifier, resource; token exchange
    D-->>G: MCP access token and refresh token
    G->>M: Bearer access token on every MCP request
    M->>M: RS256 signature, exact issuer/audience, time, scope, approved signed identity
    M->>M: Resolve service-owned configuration after approval
    M->>C: GET using dedicated CW credentials
    C-->>G: Read result through MCP
    G->>D: Refresh after access expiry
```

Our API validates access tokens; it does not authorize OAuth clients, exchange codes, store refresh tokens, proxy SAML, or host an OAuth authorization server. Descope is the MCP issuer. Entra is only the upstream identity provider. ConnectWise keys never enter either OAuth leg.

## Live evidence and exact metadata

Read-only Descope MCP inspection confirmed project `P3KF3ouEKxhaIJBilPItOXL8i76g` (`monotorr`), Monotorr tenant `T3KFWqFHykqEijPT44CosGlTDEdi`, SAML auth type, domain `monotorr.com`, Entra federation metadata and email/name attribute mappings. The approved enabled user has email `rob@monotorr.com`, `verifiedEmail: true`, SAML state and Monotorr membership. Its immutable Descope user ID is `U3KFfMleU85iOGGJcBQTzguQuVYZ`. No login session token, provider token, client secret or SAML assertion was retrieved.

User-reported completed tests: Entra SAML login, JIT creation, domain routing and attribute mapping succeeded. Management inspection corroborates configuration/user state; it did not repeat a browser login. Management `LoadAllMcpServers` and `LoadAllThirdPartyApplicationsV2` returned empty data. This does not invalidate the live resource-specific discovery below; the reason for management visibility remains unknown.

The following exact values were independently fetched from the public discovery endpoint on 2026-10-04:

| Field | Observed value |
| --- | --- |
| Discovery | `https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au/.well-known/openid-configuration` |
| Issuer | `https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au` |
| Authorization | `https://api.descope.com/oauth2/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au/authorize` |
| Token | `https://api.descope.com/oauth2/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au/token` |
| JWKS | `https://api.descope.com/P3KF3ouEKxhaIJBilPItOXL8i76g/.well-known/jwks.json` |
| Registration | `https://api.descope.com/v1/mgmt/mcp/client/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au/register` |
| Response / PKCE | `code`; `S256` |
| Supported scopes | `connectwise.read`, `offline_access` |
| Token client-auth methods | `none`, `client_secret_basic`, `client_secret_post` |
| Registration capabilities | DCR endpoint present; CIMD flag **absent** in our fetch (user previously reported null). Do not claim CIMD is enabled. Predefined-client interoperability is not established. |
| Grants | Includes `authorization_code`, `refresh_token` and additional grants. Discovery availability does not authorize those grants for this API/user. |
| Signing | Discovery advertises RS256 for ID tokens; public project JWKS independently contains an RSA RS256 signing key. Verifier permits **only RS256**; real MCP access-token algorithm remains a live check. |
| Resource | `https://api.monotorr.com/mcp` (user-confirmed resource definition; token binding not yet tested) |
| API read scope | `connectwise.read` |

Metadata `claims_supported` lists standard identity claims, including `sub`, `email` and `email_verified`. This is **not** a guarantee that an MCP access token includes them, or that `sub` equals the federated user's ID. Descope documents resource audience inclusion and space-delimited `scope`; our verifier enforces those contracts. Do not substitute a generic session token or relax the issuer/audience if actual issuance differs. [Descope discovery](https://docs.descope.com/agentic-identity-hub/core-components/mcp-servers/discovery-url), [resource token behavior](https://docs.descope.com/identity-federation/inbound-apps/authorization-server), [scope enforcement](https://docs.descope.com/sessions/validation).

## Runtime configuration and identity gate

| Variable | Required value / policy |
| --- | --- |
| `MCP_TRANSPORT` | `http` for the Azure service; stdio remains supported separately |
| `AUTH_MODE` | `env`; gateway mode stays rejected |
| `DESCOPE_MCP_ISSUER` | Exact issuer in the table above; no trailing slash |
| `DESCOPE_MCP_JWKS_URI` | Exact HTTPS public JWKS URI above |
| `MCP_RESOURCE_URI` | `https://api.monotorr.com/mcp` |
| `MCP_REQUIRED_SCOPE` | `connectwise.read` (default; any other scope rejected in this pilot) |
| `MCP_APPROVED_USER_ID` | Immutable approved user ID above, once verified in the actual signed MCP token |
| `MCP_APPROVED_USER_CLAIM` | Explicit JSON Pointer into that signed token. `/sub` is a **candidate only**, not a confirmed mapping. Nested claims can be addressed explicitly; no alternative-claim fallback exists. |
| `MCP_HTTP_HOST`, `MCP_HTTP_PORT` | Bind address/port chosen for controlled Azure ingress |
| `NODE_ENV` | `production` for deployment; local unauthenticated exception cannot operate in production |
| `CW_MANAGE_*` | Existing service-owned CW configuration; supplied securely outside the repository. No new secret-storage implementation. |

Do not configure the console operator ID from `session.whoami` as the resource user. It differs from the approved federated user's ID. Do not configure email as a substitute for an unverified user-ID mapping. This implementation deliberately uses an immutable ID and configurable signed-claim path, avoiding an unproven email/verified-email claim policy.

For the first controlled exchange, an explicit candidate `/sub` plus the known user ID may be configured: it only succeeds if the signed MCP token matches, and otherwise returns 403. Confirm the human-identity semantics and stability privately using an authorized local validator/operator workflow; never paste tokens here or print them in application logs. If the actual token instead identifies an agent/client and provides no trustworthy human claim, **stop the live test** for a reviewed broker claim-mapping design. Do not allow every project user or fall back to HTTP/MCP-supplied identity.

Incomplete/invalid auth settings fail startup before socket binding. Configuration rejects HTTP/userinfo/query/fragment URLs and generic session/Entra issuer shapes. JOSE uses configured public JWKS with caching and bounded network timeout, not hardcoded keys or JWT-supplied `jku`/`x5u`. No automatic discovery rewriting or trust in a caller-selected issuer. Keys are shared within a Descope project, so exact resource-specific issuer, audience and scope checks are essential.

## Resource metadata and HTTP behavior

Canonical public GET: `https://api.monotorr.com/.well-known/oauth-protected-resource/mcp`. Its JSON identifies the exact resource, issuer, read scope and header Bearer method. A missing token produces:

```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="https://api.monotorr.com/.well-known/oauth-protected-resource/mcp"
```

Invalid tokens use 401 plus `error="invalid_token"`. Missing read scope uses 403 plus `error="insufficient_scope", scope="connectwise.read"`. An unauthorized signed user uses 403 `forbidden`; it does not imply a token is cryptographically invalid. Unexpected verifier/JWKS failures deny with sanitized 401, with no raw diagnostic object/claims. Responses are not cached.

No root PRM alias is implemented: path-qualified discovery is standard and the challenge explicitly points to it. It avoids collision with other `api.monotorr.com` resources. If the live client requires another standard discovery location, record the failure and review/test a deliberate alias; do not assume or overwrite Monotorr routes. No local authorization-server well-known, `/authorize`, `/token`, `/register` or SAML callback is mounted. [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html), [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

All `/mcp` requests are authenticated before configuration lookup, MCP server/transport creation or CW execution. Only POST is currently supported. Origin allowlisting and caller `X-CW-*` rejection remain. `health` remains shallow/public; Worker stays disabled by default. The API returns an HTTP OAuth challenge before parsing denied MCP bodies; it does not weaken the gate for anonymous initialization or tool-level linking. Expired-link recovery must be tested in ChatGPT.

All 39 read tools now emit top-level `securitySchemes` and matching `_meta.securitySchemes`, with read-only/non-destructive annotations. SDK 1.32 drops an unrecognized top-level registration property; a narrowly scoped adapter wraps its public `tools/list` handler and decorates the serialized descriptors. It preserves schemas, UI metadata and callbacks. Automated HTTP wire tests verify both fields rather than trusting TypeScript casts. All 16 write tools remain absent; the CW client remains GET-only.

## Manual test sequence after separately authorized deployment

Never capture OAuth codes, assertions, Authorization headers or refresh/access tokens in HAR exports, screenshots, logs, tickets or this repository. Inspect values privately; retain only PASS/FAIL and sanitized error categories. Deployment needs trusted HTTPS ingress and redacted infrastructure logs; Node's internal HTTP listener behind TLS termination is not a public plaintext endpoint.

| Step | Action / evidence | PASS | FAIL |
| --- | --- | --- | --- |
| 1 | GET canonical PRM with the command below | 200 public JSON; exact resource, Descope issuer, read scope | TLS/redirect/login failure, mismatched fields |
| 2 | GET exact Descope discovery above; inspect JWKS key types | Exact issuer/endpoints; S256, code, read/offline scopes, RS256 key | Changed issuer, missing S256, unavailable JWKS |
| 3 | Add `https://api.monotorr.com/mcp` in ChatGPT's supported private connection UI | 401 discovery challenge accepted; actual registration method recorded | Anonymous execution, discovery/client registration rejection |
| 4 | Observe OAuth browser redirect | Actual Descope endpoint; S256 and same resource; exact callback | Entra used directly as AS, resource removed, guessed/wildcard callback |
| 5 | Enter `rob@monotorr.com` | Approved identity selected for Monotorr route | Another user/domain, unintended local login fallback |
| 6 | Descope routes to Monotorr Entra SAML | Correct tenant/application federation path | Wrong tenant/connection, no SSO routing |
| 7 | Complete Entra login/MFA | Tenant policy honored and login succeeds | MFA/policy failure or bypass |
| 8 | Return to Descope | Validated SAML result tied to approved federated user | Broken ACS/state/user association |
| 9 | Complete read OAuth grant/consent | Only intended resource/read grant; requested offline access handled | Extra backend permissions, unintended user access or missing consent |
| 10 | ChatGPT exchanges code for MCP access token | Same resource retained; issuer/audience/scope/algorithm match; human claim privately verified | Session/ID token substituted, invalid client/resource or unverified identity semantics |
| 11 | ChatGPT sends Bearer access token to `/mcp` | Header-only JWT accepted by verifier | Token in URL, malformed header, no bearer request |
| 12 | Verify signature/issuer/audience/time/scope/approved user | Approved signed immutable identity matches; negatives denied before config/CW | Generic token accepted, unmatched identity, secret resolution before auth |
| 13 | Initialize and list tools | 39 reads; no 16 writes; OAuth metadata survives host processing | Discovery/serialization issue, write tool present |
| 14 | One administrator-selected safe read query | Expected CW data under dedicated read-only API member | API permission failure, write activity, tokens passed downstream |
| 15 | Close any console, wait past actual access expiry, then repeat read | ChatGPT refreshes via Descope; renewed token remains bound to approved user/resource/scope | Repeated login each expiry, no refresh, replay/policy issue, console dependence |

Read-only public checks (no files written):

```sh
curl --fail --silent --show-error --max-time 15 \
  https://api.monotorr.com/.well-known/oauth-protected-resource/mcp
curl --fail --silent --show-error --max-time 15 \
  https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au/.well-known/openid-configuration
curl --silent --show-error --max-time 15 --include --request POST \
  https://api.monotorr.com/mcp \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"auth-check","version":"1"}}}'
```

Also test invalid/expired/wrong issuer/audience/scope/user tokens on initialize/list/call using an isolated authorized test harness; never disable verification to manufacture PASS. Verify replay protection and grant revocation, JWKS rotation/outage behavior, alternative-login restrictions and Entra deprovisioning latency. Stateless validation alone does not immediately detect an upstream user being disabled; measure and approve the actual deny interval.

## Readiness and remaining gates

Final local verification on 2026-10-04:

| Check | Result |
| --- | --- |
| `npm install` | Exit 0; dependencies already current; manifest/lock unchanged. Reports the existing 3 high development entries; no production finding. |
| `npm run build` | Exit 0 |
| `npm run lint` | Exit 0; no findings |
| `npm test` | Exit 0; 9 files, 157 tests passed, 0 failed (39 added auth tests) |
| `npm audit --omit=dev` | Exit 0; 0 vulnerabilities |
| `git diff --check` | Exit 0 |
| Change scan | No private-key, complete JWT or SAML assertion patterns; no dependency changes or changes to CW tool implementations/client. No live credentials added. |

Offline tests generate RSA keys/tokens in memory and use a local JWKS resolver. They cover missing/malformed/duplicate Bearer headers, signed success, invalid signatures/algorithms, wrong/Entra/generic issuers, wrong audience, expiry/nbf, scope and explicit immutable-user checks, JWKS/verifier failure, sanitized output, denial before configuration/CW access, public PRM and real HTTP initialization/list/call output. Existing write-denial/GET-only and TLS tests remain. The existing UI-only metadata assertion was narrowed to UI fields so OAuth metadata does not count as a card declaration. All tests use synthetic identities and mocked CW responses, not live Entra/Descope/CW tokens or services.

PASS: user-reported upstream SAML/JIT login; independently corroborated tenant/user/mapping configuration; independently fetched real Descope S256 discovery and RS256 public key. Offline resource-server negatives and HTTP wire tests are documented in the implementation report.

NOT YET VALIDATED: real ChatGPT registration/exchange/callback handling; actual MCP JWT user claim, access-token type/algorithm/audience/scope; refreshed-token claim stability, replay handling/persistence; approved-user/Entra-only broker consent policy; public Azure routing/TLS/logging; real CW member permissions and read query. Discovery's standard claims are not token evidence. No CIMD support is claimed.

Code supports a fail-closed deployment candidate. Proceed to a separately reviewed controlled Azure deployment/ChatGPT test only with exact issuer/JWKS and explicit candidate identity policy, redacted ingress and securely supplied CW configuration. It is not production-approved until the live gates pass. No setup/admin console or Key Vault integration was added; those remain separate work.
