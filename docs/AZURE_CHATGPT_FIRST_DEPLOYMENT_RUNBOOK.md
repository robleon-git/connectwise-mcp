# First controlled Azure / ChatGPT OAuth deployment

> **Live discovery follow-up, 2026-10-05 (user-reported):** the local OAuth diagnostic verified an approved-ID match at `/sub`; Azure now uses `/sub`, with one active revision receiving 100% traffic. Fresh ChatGPT OAuth succeeds but action discovery fails. Bootstrap `/exp` instructions below are historical; this diagnostic task must not change Azure, Descope policy, the approved claim path or CW credentials. The extended local helper now probes authenticated SDK initialize/initialized/tools/list, without executing tools.

Prepared 2026-10-04 from canonical repository `/Users/rleon/Development/connectwise-mcp`, branch `phase1-hardening`, implementation commit `37203c3` (`Add Descope MCP authentication`). This is a manual runbook, not a deployment. No Azure/DNS/Descope/Entra changes, secrets or authentication code were added. Read alongside [Phase 1 hardening](PHASE1_HARDENING.md), [broker decision](MCP_AUTHORIZATION_BROKER_OPTIONS.md) and [Descope live-test evidence](CHATGPT_DESCOPE_MCP_LIVE_TEST.md).

**Decision:** use a separate Azure Container App for the existing container, keeping `https://api.monotorr.com/mcp`. First deploy without CW credentials and with the existing user gate deliberately closed. Determine a candidate human-identity claim using a real resource token in a local, non-authorizing diagnostic; then confirm that mapping through the real ChatGPT request. Only afterward add service-owned CW configuration for a controlled read. No application change is required for this sequence.

Startup review: `Dockerfile` builds UI and TypeScript on Node 26 Alpine, prunes development dependencies, runs as UID 1001 and starts `node dist/index.js`. It listens on `0.0.0.0:8080` with production HTTP/environment mode. Auth settings must validate before the socket is opened. The public JWKS is fetched on token verification, not startup; health does not prove JWKS/OAuth/CW readiness. `.env` is not automatically loaded. Azure must supply environment settings explicitly. Docker excludes real `.env` files/docs/Git; do not put any secrets in build arguments/context. Existing Compose templates do not forward the new auth settings and are **not** the Azure deployment path. Local Docker daemon access was sandbox-denied during this review; an image build/run/scan is still a manual preflight, not a claimed PASS.

Initial preparation verification (2026-10-04): the former prompt diagnostic passed syntax checks, and an offline check confirmed `/exp` denies both synthetic approved and other users. **Local-helper update (2026-10-05):** `scripts/validate-mcp-user-claim.mjs` replaces manual token copying for claim discovery; focused offline tests and the full validation suite accompany that change. No Azure/Descope live action or production claim-policy change was performed.

## Pre-Deployment Checklist

- [ ] Confirm tenant/subscription access and the deployment operator; no new Entra OAuth app registration is required for our resource server.
- [ ] Record actual subscription ID, region, resource group/environment/app/registry names, image digest, DNS owner, existing `api.monotorr.com` routing and previous configuration. These cannot be inferred from this repository.
- [ ] Determine whether `api.monotorr.com` already serves Monotorr. Do not replace its DNS or routes without a reviewed routing plan. Sharing a hostname does not imply sharing application/configuration boundaries.
- [ ] Confirm ChatGPT account/workspace permits a private custom MCP connection; only Rob is participating. No public listing/sharing.
- [ ] Recheck real Descope discovery, upstream Monotorr SAML routing and approved-user record read-only. Do not change registration policies, clients or federation as part of preflight.
- [ ] Keep public HTTP authenticated; no `MCP_ALLOW_UNAUTHENTICATED_LOCAL=true`, static bearer fallback, direct Entra token validation, generic session tokens or metadata rewriting.
- [ ] Prepare the closed claim gate below; omit **all** `CW_MANAGE_*` credentials for Stage A. Do not source `.env.example` into a production shell.
- [ ] Run the approved local claim helper on a trusted workstation. Its one temporary OAuth client is created through normal DCR only when the operator executes it; no such action was performed in preparing this change. Optional Inspector use remains a separate tooling decision.
- [ ] Redact ingress/application logs; disable token/request-body captures, HAR exports, session recording and optional third-party tracing. Store only status/error categories and sanitized test results.
- [ ] Build, test and scan the exact image before Azure creation. Do not use an inherited WYRE image or an unpinned `latest` deployment.

Run this build preflight manually from the canonical repo; it writes build outputs only there and does not deploy:

```sh
cd /Users/rleon/Development/connectwise-mcp
git branch --show-current
git status --short
git rev-parse HEAD
npm ci --ignore-scripts
npm run build:ui
npm run build
npm run lint
npm test
npm audit --omit=dev
git diff --check
docker buildx build --platform linux/amd64 --load --tag connectwise-mcp:pilot .
```

Expected: branch `phase1-hardening`, understood working tree, all checks successful, production audit clean. Last recorded implementation suite: 9 files/157 tests; not rerun for this documentation-only task. Current advisories and image build are fresh gates. Build on AMD64 explicitly when using an Apple Silicon workstation. Run the resulting container locally with the nonsecret Stage A auth settings, **no CW credentials**, port published to `127.0.0.1` only; confirm `/health`, PRM and anonymous 401. Scan with approved image tooling and record digest. Inspect final image configuration to ensure no embedded keys/tokens. Stop on build/startup failure or production findings.

## Azure Resources Required

Recommended dedicated names below are proposals, not existing resources. Reuse the Microsoft tenant/subscription, not Monotorr's service, identity, secrets or deployment pipeline.

| Resource | Minimum controlled configuration |
| --- | --- |
| Resource group | `rg-connectwise-mcp-pilot`; approved region, service-specific RBAC/tags and ownership |
| Container Apps environment | `cae-connectwise-mcp-pilot`; public-capable Consumption environment, isolated from Monotorr applications |
| Container App | `ca-connectwise-mcp-pilot`; Linux AMD64 image; 0.5 vCPU/1 GiB starting allocation; minimum/maximum replicas both 1 during testing |
| Private image registry | Dedicated ACR, or approved existing ACR with separate image repository and restricted access; no admin-password auth |
| Image-pull identity | Separate managed identity with the registry's applicable pull-only role; no Graph, Monotorr or CW permissions |
| Domain/certificate | `api.monotorr.com` binding and trusted managed TLS certificate if hostname is free; existing approved edge routes if shared |
| Logs | Restricted console/system-log access. Persisted diagnostic workspace is optional for this pilot; select retention/redaction deliberately |

Manual portal sequence after separate deployment authorization:

1. Select the existing tenant and actual subscription. Create the dedicated resource group, registry/repository and public-capable Container Apps environment. Do not choose an internal-only environment for direct ChatGPT ingress.
2. Push the tested image to the approved registry; record its immutable digest. Attach the separate pull identity and appropriate registry RBAC. Registry role depends on its RBAC/ABAC mode; verify pull succeeds rather than enabling the registry admin account. [Managed-identity pulls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull).
3. Create the separate Container App from that digest, single revision initially, using Stage A settings below. Leave built-in Azure Authentication/Easy Auth disabled: the application's existing Descope verifier is the OAuth boundary, not a platform browser-login redirect.
4. Set HTTP ingress external, target port **8080**, HTTPS-only (`allowInsecure=false`), transport Auto, no extra TCP exposure, no wildcard CORS or session affinity. One warm replica avoids cold-start uncertainty. Public generated Azure FQDN also enforces the same bearer gate; the accepted resource/audience stays the canonical URL, not that FQDN. [Ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview).
5. Add HTTP startup/readiness/liveness probes on port 8080, path `/health`. Proposed startup: interval 5 s, timeout 2 s, failure threshold 30; readiness/liveness: interval 10 s, timeout 2 s, failure threshold 3. Container Docker HEALTHCHECK is not a substitute for Azure probes. [Health probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes).
6. Verify internal health and no credential settings; complete the DNS/TLS section. Route PRM and `/mcp` to the same revision, preserving paths, Authorization and `WWW-Authenticate` headers without response caching.

No APIM, AKS, VM, database, setup UI, Key Vault integration, new authorization server or new application telemetry is needed for the Stage A test. Outbound HTTPS/DNS must reach Descope JWKS; Stage B additionally needs the final public CW API. If that API requires fixed source-IP allowlisting, establish its actual network requirement before adding CW credentials; a static Azure outbound path is additional infrastructure, not assumed available.

## Runtime Configuration

### Known nonsecret Stage A values

| Environment variable | Value | Requirement |
| --- | --- | --- |
| `NODE_ENV` | `production` | Required pilot setting; local anonymous exception disabled |
| `MCP_TRANSPORT` | `http` | Required; bare Node defaults to stdio |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind inside container |
| `MCP_HTTP_PORT` | `8080` | Must match ingress/probes |
| `AUTH_MODE` | `env` | Service configuration; gateway rejected |
| `DESCOPE_MCP_ISSUER` | `https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au` | Exact issuer, no trailing slash |
| `DESCOPE_MCP_JWKS_URI` | `https://api.descope.com/P3KF3ouEKxhaIJBilPItOXL8i76g/.well-known/jwks.json` | Configured public signing keys |
| `MCP_RESOURCE_URI` | `https://api.monotorr.com/mcp` | Exact resource/audience |
| `MCP_REQUIRED_SCOPE` | `connectwise.read` | Explicit; also application default |
| `MCP_APPROVED_USER_ID` | `U3KFfMleU85iOGGJcBQTzguQuVYZ` | Known Rob federation ID; validate human-claim mapping live |
| `MCP_APPROVED_USER_CLAIM` | `/exp` **temporarily, closed gate only** | Final user-claim path is unknown; this is deliberately not an identity mapping |
| `MCP_ALLOW_UNAUTHENTICATED_LOCAL` | `false` | Optional variable, set explicitly for clarity |
| `CW_MANAGE_REJECT_UNAUTHORIZED` | `true` | Required secure pilot policy for later CW config |

Why `/exp` safely closes authorization: JOSE requires a valid numeric `exp` before user authorization; the configured approved ID is a string. The verifier's strict equality cannot match those types. Valid resource tokens therefore receive 403 `forbidden`; bad/missing tokens still receive 401. This uses the existing verifier unchanged, introduces no arbitrary-user access, and is **not** a guess at the final user claim. Missing/blank claim configuration instead prevents startup and prevents discovery, so do not use a blank value to bootstrap.

### Stage B configuration: administrator-provided, not known here

| Variable | Classification | Required for CW tool use |
| --- | --- | --- |
| `CW_MANAGE_URL` | Nonsecret but instance-specific | Final HTTPS API URL; never rely on the cloud default for the intended on-prem server; no redirects/userinfo/query/fragment |
| `CW_MANAGE_COMPANY_ID` | Nonsecret customer identifier; treat as confidential configuration | Yes |
| `CW_MANAGE_PUBLIC_KEY` | Credential material; protect as secret despite its name | Yes |
| `CW_MANAGE_PRIVATE_KEY` | Secret | Yes |
| `CW_MANAGE_CLIENT_ID` | Client identifier; protect as confidential configuration | Yes |

Stage A requires **zero application secrets**. Leave the four CW identity/key variables absent, not filled with placeholders. For Stage B, an authorized operator supplies them through service-specific Azure Container App secret references for credential material, never a committed env file, Docker argument, CLI plaintext secret argument or tool input. Azure app secret references can populate environment variables without an application Key Vault adapter; Key Vault integration remains deferred. Changing application secrets may require restarting/deploying the affected revision to consume them. [Container App secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets).

`MCP_APPROVED_USER_CLAIM` cannot be finalized until real resource-token issuance/semantics are checked. Keep the known user ID fixed; do not replace it with an OAuth client, agent, console operator, email domain or arbitrary token subject. `LOG_LEVEL=info` is an optional inherited image setting; diagnostics do not become verbose through it. Branding variables, `MCP_HOSTNAME`/`ACME_EMAIL` (Compose/Caddy), Azure/Entra client secrets, legacy OAuth/static-bearer settings and refresh tokens are not needed. There is currently no startup environment variable for an Origin allowlist; the CLI supplies none. If an actual client sends an Origin and receives `origin_denied`, stop for a narrow reviewed change, not wildcard CORS.

### Exact credential-resolution behavior

`createHttpHandler` authenticates first. For **every accepted POST**, it then calls `configProvider`/`getConfig`, checks TLS policy, and creates a fresh MCP server **before** transport dispatch. Thus initialize/list resolve configuration too; resolution is not deferred until tools/call. Denied requests and public PRM/health never resolve CW configuration.

With all CW credentials omitted, `getConfig()` returns `null`. Initialize succeeds once user authorization passes. `tools/list` exposes exactly **one** OAuth-protected `cw_test_connection` diagnostic; invoking it returns `isError: true` explaining missing configuration and makes no CW call. With complete valid config, creation constructs a CW client but does not call the API; list exposes all **39** reads. A CW network request happens only when a tool handler executes. Partial credentials can also yield null, so omit all Stage A values deliberately and require a complete Stage B set.

## DNS and TLS

First inspect existing authoritative records and ownership manually:

```sh
dig +short CNAME api.monotorr.com
dig +short A api.monotorr.com
dig +short AAAA api.monotorr.com
dig +short CAA monotorr.com
```

**If the hostname is free for this service:** use direct ACA custom-domain binding. In the `monotorr.com` zone, set `CNAME api` to the app's actual generated Azure FQDN and `TXT asuid.api` to its actual `customDomainVerificationId`, both copied from the Azure portal. No path belongs in DNS. Bind hostname `api.monotorr.com`, request the managed certificate and wait for successful issuance. If CAA limits issuers, permit DigiCert. Keep the app running and the direct CNAME intact for renewal; proxy/intermediate-CNAME configurations can prevent managed issuance. [Managed domain/certificates](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates).

**If the hostname already serves Monotorr:** do not replace DNS. Obtain the existing edge owner’s approved routing plan: `/mcp` and `/.well-known/oauth-protected-resource/mcp` must reach this separate app unchanged; unrelated Monotorr routes stay untouched. TLS remains at that edge with trusted HTTPS to the ACA origin and correct backend host/SNI. Do not use the direct-CNAME managed-certificate recipe behind an incompatible proxy. A shared edge is a routing component, not shared application auth/state. If no such routing is available, this is a manual-deployment blocker, not permission to change the public URL or introduce a new gateway here.

Public TLS must validate hostname/chain normally, with TLS 1.2+; never use `curl -k` or disable CW TLS verification. External port is 443; internal 8080 is not a public TCP endpoint. Metadata is public without login redirects. Token/auth responses must not be cached or have Bearer challenge headers stripped. Verify the default Azure hostname is also protected; there is no alternate unauthenticated backend. Restricting only to the operator IP prevents ChatGPT; do not invent a ChatGPT IP allowlist. DNS, certificate status, shared-edge inventory and actual routing are unverified until the operator checks them.

## Authentication Smoke Tests

Use a normal trusted TLS connection; commands below contain no secrets. Expected PRM:

```json
{
  "resource": "https://api.monotorr.com/mcp",
  "authorization_servers": ["https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au"],
  "scopes_supported": ["connectwise.read"],
  "bearer_methods_supported": ["header"]
}
```

```sh
curl --fail --silent --show-error --max-time 15 --include \
  https://api.monotorr.com/.well-known/oauth-protected-resource/mcp
curl --silent --show-error --max-time 15 --include --request POST \
  https://api.monotorr.com/mcp \
  --header 'Content-Type: application/json' \
  --header 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"pilot-check","version":"1"}}}'
curl --fail --silent --show-error --max-time 15 \
  https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au/.well-known/openid-configuration
```

| Check | Exact expected result |
| --- | --- |
| GET `/health` | 200, `{"error":"ok"}`; liveness only |
| GET canonical PRM | 200 JSON above, `Cache-Control: no-store`, no secret lookup |
| Anonymous POST `/mcp` | 401, `{"error":"unauthorized"}`; challenge below; no config/CW access |
| Invalid token | 401, `{"error":"invalid_token"}`; challenge adds `error="invalid_token"` |
| Valid token, closed `/exp` user gate | 403, `{"error":"forbidden"}`; no config/CW access |
| Valid token missing read scope | 403 `insufficient_scope`; challenge includes read scope |
| Descope AS discovery | Exact issuer/JWKS/authorize/token endpoints from evidence; `code`, `S256`, `connectwise.read`, `offline_access`; real registration endpoint; do not assume CIMD |
| Authorized initialize after claim confirmation | 200 JSON-RPC result with server info/capabilities/protocol; no CW API traffic |
| Authorized list, Stage A | 200 JSON-RPC result; one diagnostic tool with OAuth descriptors |
| Authorized list, Stage B | 200; all 39 original reads, zero writes; top-level and mirrored security metadata |
| Safe tool call, Stage A | Diagnostic `isError:true` for missing CW config; **expected**, not authentication failure |
| Safe tool call, Stage B | Successful read result; no writes; no raw token or CW key in output/logs |

Required missing-token header (header-name casing is immaterial):

```http
WWW-Authenticate: Bearer resource_metadata="https://api.monotorr.com/.well-known/oauth-protected-resource/mcp"
```

No root PRM alias is implemented; expect 404 there. Do not add a redirect/alias to fix a client failure without recording and reviewing it. POST-only stateless transport means authenticated GET `/mcp` returns 405; legacy SSE and session IDs are not needed. ChatGPT must negotiate a supported protocol, not rely on this manual smoke-test version. Preserve the endpoint gate if anonymous metadata initialization is requested.

For authenticated initialize/list/read, use ChatGPT or a separately approved local Inspector connection after identity configuration is authorized. The claim helper below does not call MCP or expose a token for manual curl use. Do not put a token in `curl -H`, process arguments, environment files, shell history or HTTP query strings. Expected JSON-RPC bodies are:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"pilot-check","version":"1"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cw_test_connection","arguments":{}}}
```

## ChatGPT OAuth Test

1. Complete public smoke tests with the `/exp` gate closed and no CW credentials. Existing broker registration policy stays unchanged; discovery currently advertises DCR, not CIMD.
2. In the actual ChatGPT workspace enable its approved private/developer connection controls, then add `https://api.monotorr.com/mcp` with OAuth. The UI name can vary; use the current documented connection workflow. [OpenAI connection testing](https://developers.openai.com/plugins/deploy/connect-chatgpt).
3. Observe discovery to our PRM and the genuine Descope AS. Record only registration method/status and sanitized error. Copy any callback needed through the actual supported client workflow; do not invent a callback or change broker policies to force a pass. An existing DCR route may register a client during the live test; this future test is distinct from today's no-mutation preparation.
4. Browser authorization must go to Descope, preserving `resource=https://api.monotorr.com/mcp`, S256 and read scope; request offline access for persistence. Enter `rob@monotorr.com`; Descope routes to Monotorr Entra SAML; complete login/MFA and Descope consent.
5. ChatGPT, not the browser configuration console or our API, exchanges code for an MCP access token. Initial `/mcp` execution is expected to fail 403 while the gate is closed. The connection UI may report failure after issuance; that is **not full linking PASS**, nor proof by itself that issuance succeeded. A new linking attempt may be required later.
6. Use the claim-validation procedure below. With a verified candidate mapping, change only the service's nonsecret claim configuration/revision, keeping the exact approved user ID. Reconnect in ChatGPT. Successful initialization proves that its actual presented token satisfies the chosen signed-claim comparison, issuer/audience/time/scope checks; Inspector alone does not prove that.
7. Confirm authenticated initialize/list with the one Stage A diagnostic. Close the console browser; verify the connection does not depend on that session. Then perform Stage B under the separate CW configuration step.
8. Wait beyond the issued access lifetime and verify refresh/reconnection through ChatGPT without a console login. Repeat claim restriction and scope/audience checks, then test approved revocation/deprovisioning behavior within an agreed interval.

Do not intercept/export ChatGPT token storage: its access token normally travels server-to-server, and the login browser's SAML/preview JWT is not that token. No public diagnostics endpoint or request-log token capture is proposed. Registration failure, Origin rejection, resource/issuer mismatch or repeated login is a recorded interoperability FAIL, not justification to alter the architecture.

## Approved User Claim Validation

Claim-path validation returned `["/sub"]`, as reported by the operator. Azure is already configured with `/sub`; **do not change it during this discovery diagnostic**. The helper never reads or changes that policy and never selects/applies a path automatically.

A standalone helper now handles the entire local OAuth exchange without Inspector, token copying, Python prompts or new dependencies:

```sh
cd /Users/rleon/Development/connectwise-mcp
node scripts/validate-mcp-user-claim.mjs
```

Run on the trusted workstation where the browser is available, with existing repository dependencies installed and supported Node (22.19+; Node 26 recommended). The script imports existing JOSE directly; it does not need a TypeScript build to run. It has pinned **nonsecret** defaults for the exact pilot issuer, public JWKS, resource, read scope and Rob ID. Existing `DESCOPE_MCP_ISSUER`, `DESCOPE_MCP_JWKS_URI`, `MCP_RESOURCE_URI`, `MCP_REQUIRED_SCOPE` and `MCP_APPROVED_USER_ID` environment values may agree with those defaults; conflicting values fail closed. It never reads or modifies `MCP_APPROVED_USER_CLAIM`, `.env` files, Azure configuration or CW credentials. After verification it sends only authenticated MCP discovery requests to the exact canonical endpoint; it executes no tool. It accepts no command-line arguments or token inputs.

The helper:

1. Fetches real Descope resource discovery and requires exact issuer/JWKS/authorize/token/registration endpoints, advertised S256/code, read/offline scopes and public client method `none`. Missing/incompatible discovery is failure, not a metadata override.
2. Binds an ephemeral port on **127.0.0.1 only**, with random callback path/state, a five-minute callback timeout and one-use code handling. It validates state, duplicates and any returned response issuer; RFC 9207 issuer is required when advertised. Callback pages are generic/noncached with no-referrer policy; no codes/errors are echoed.
3. Dynamically registers **one temporary diagnostic public client** using existing advertised DCR, authorization-code/refresh grants and its exact loopback callback. Running the helper is authorization for that diagnostic registration only, not changing production resource/SSO/client policy. Nothing was registered during offline development/tests. Each run can leave a broker client/consent record; the helper does not use administrative credentials or silently delete/revoke records. Arrange authorized cleanup separately.
4. Opens the default browser for code/S256 OAuth with `resource=https://api.monotorr.com/mcp` and `scope=connectwise.read offline_access`. If auto-open fails, only the standard authorization URL is printed to stderr; copy that URL to your browser. Sign in as `rob@monotorr.com` through Monotorr Entra SAML/MFA and consent. Do not use a login-preview JWT.
5. Receives the standard OAuth code locally and exchanges it over HTTPS using the matching redirect/state-derived flow and PKCE verifier, preserving the resource parameter. No verifier, code or token is printed. It uses **access_token only**, never ID/refresh/session tokens.
6. Verifies RS256 signature through the existing public JWKS, exact issuer/audience, required expiry/not-before and `connectwise.read`, matching the application's access-token contract. It walks the verified payload and compares values by strict equality only to `U3KFfMleU85iOGGJcBQTzguQuVYZ`.
7. When a match exists, uses the installed MCP SDK `Client`/`StreamableHTTPClientTransport` with the access token held in an in-memory Authorization header. `Client.connect` negotiates initialize and sends the initialized notification; `Client.listTools` validates responses and follows pagination. Requests remain pinned to `https://api.monotorr.com/mcp`, with redirects rejected and bounded timeouts. No SDK auth fallback/refresh flow or tool execution is enabled. No match exits 2 before any MCP request.
8. Outputs allowlisted discovery facts only: verified matching paths, initialization/list success, supported negotiated protocol, bounded CW tool identifiers/count, and failure stage/HTTP status when available. Error messages/bodies, descriptions/schemas, session IDs, cursors and tokens are omitted. SDK error callbacks and schema-validator logging cannot print server-provided text. The existing SDK/AJV packages are used without adding dependencies. Finally closes the SDK transport/loopback listener and discards token response material; no files/state cache are written.

Stdout success example **only if that path actually matches**:

```json
{"resourceTokenVerified":true,"approvedIdMatchPaths":["/sub"],"mcpInitializeSucceeded":true,"toolsListSucceeded":true,"protocolVersion":"2025-11-25","toolCount":1,"toolNames":["cw_test_connection"]}
```

Protocol version above is illustrative; the helper reports actual supported SDK negotiation. Stage A intentionally has no CW credentials: one diagnostic tool is successful discovery, not a missing-credential failure. The helper never invokes that tool. Optional SDK GET stream setup may return 405; the SDK explicitly accepts this for a POST-only server.

Nested/array paths are also supported; `/sub` above is illustrative, not an assumed final identity claim. No-match stdout:

```json
{"resourceTokenVerified":true,"approvedIdMatchPaths":[]}
```

Exit codes: **0** verified matching token and successful MCP discovery; **2** verified token with no approved-ID match (MCP not attempted); **3** MCP handshake/list failure after token verification; **1** failed OAuth/token verification, incompatible config or unsafe output. Exit 1 emits only `{"resourceTokenVerified":false,"approvedIdMatchPaths":[]}`. Browser fallback URL is the sole permitted additional stderr output.

A sanitized failure can look like:

```json
{"resourceTokenVerified":true,"approvedIdMatchPaths":["/sub"],"mcpInitializeSucceeded":false,"toolsListSucceeded":false,"failureStage":"initialize","httpStatus":403}
```

Failure stages are `initialize`, `initialized` or `tools/list`. Initialize may have succeeded even if the initialized notification failed. HTTP status is omitted for network/timeout failures without a response; status 200 can accompany invalid protocol/schema data. Raw response bodies are never included. A successful local diagnostic narrows the problem to ChatGPT-specific interoperability; it does not prove the actual ChatGPT discovery path or token claims succeed.

Use a trusted browser/workstation; avoid recording/HAR exports, process-memory dumps, tracing proxies and debug instrumentation. Browser history necessarily sees standard OAuth authorization/callback parameters. The script never writes token secrets to argv, env files or disk; local memory/OS/browser remain part of the trust boundary. Existing broker policy might reject loopback callbacks or public DCR. Record sanitized failure and stop; do not change production settings or downgrade PKCE to force this diagnostic through.

**A matching path is candidate evidence, not automatic permission to open the production gate.** Verify it identifies Rob as the delegated human, not the client owner/agent or another context, and is stable across refresh/different OAuth clients. A local diagnostic client is not ChatGPT and does not prove ChatGPT-specific claims or refresh behavior. Preserve the already configured `/sub`; any future policy/configuration change requires separate review/authorization. If no immutable approved-human match exists, stop for a claim-mapping review; never accept arbitrary users or client-supplied identities.

Offline tests use generated in-memory RSA keys/local JWKS and mocked discovery/DCR/token responses; loopback callback tests exercise state/issuer/replay/timeouts without contacting Descope. Required full build/lint/test/audit checks accompany the helper change. The prior live `/sub` match is user-reported evidence; the new authenticated live discovery probe has not been executed during development.

The extension tests cover real SDK message ordering, optional GET 405, sanitized initialize/notification/list/network failures, pagination, token-shaped metadata rejection and schema-warning suppression. An integration test uses the actual local authenticated Stage A handler with null CW configuration; SDK initialization and the one-tool inventory pass. No dependency or production auth/tool source changes. No live DCR/browser/token exchange or Azure action was executed during development of this extension.

Discovery-extension verification: UI build, TypeScript build, application/helper lint, helper syntax, production audit and `git diff --check` passed; full suite **10 files / 185 tests / 0 failures**, production audit **0 vulnerabilities**. The successful local Stage A handshake is not proof that the deployed Azure endpoint or ChatGPT action discovery passes; run the same command above to obtain the live sanitized facts.

### Safe server-side discovery diagnostics

The operator has now reported successful live SDK initialize and tools/list with a verified resource token and `/sub` match. ChatGPT-specific action discovery still needs verification. The server instrumentation added for that investigation requires a separately authorized deployment; this task does not deploy it or change configuration.

Logs are single-line JSON on stderr, always enabled, with a server-generated `requestId` shared by auth, RPC and final HTTP status events. No incoming correlation header is used. Filter events to `auth.accepted`, `auth.denied`, `mcp.request` and `mcp.response` during a fresh ChatGPT connection attempt.

- `auth.denied` reasons: `no_bearer_token`, `malformed_bearer_token`, `jwt_verification_failed`, `issuer_validation_failed`, `audience_validation_failed`, `time_validation_failed`, `required_claim_missing`, `missing_scope`, `approved_user_missing`, `approved_user_mismatch`. Unexpected authenticator exceptions use `authenticator_failed`. JOSE/JWKS failures are classified without printing the error or token. A missing required `sub` is rejected during JWT verification and classified as `approved_user_missing` when the configured pointer is `/sub`.
- `auth.accepted` records only the request ID and safe configured claim path. Identity-check denials also record the safe path. `/sub` is printed literally; every other configured path is masked as `[configured]`. Neither compared value is logged.
- `mcp.request` records `method`, fixed `path=/mcp` and an allowlisted SDK-parsed `rpcMethod`: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping`, or `other`. The logger neither parses nor retains a request body. Rejected requests never reach this hook, and malformed JSON can fail before it. Correlate these cases using the final response event.
- `mcp.response` records the HTTP method, fixed path and final status on response `finish`, including pre-auth Origin denials, auth failures and SDK failures. Aborted connections that never finish do not produce a final-status event. Optional GET stream setup can legitimately return 405.

Example safe events (IDs are generated by the server):

```json
{"event":"auth.denied","requestId":"<uuid>","reason":"approved_user_mismatch","claimPath":"/sub"}
{"event":"auth.accepted","requestId":"<uuid>","claimPath":"/sub"}
{"event":"mcp.request","requestId":"<uuid>","method":"POST","path":"/mcp","rpcMethod":"tools/list"}
{"event":"mcp.response","requestId":"<uuid>","method":"POST","path":"/mcp","status":200}
```

An identity denial followed by 403 distinguishes a ChatGPT token-claim problem from an accepted request that reaches initialize/list. Accepted auth with no RPC event can indicate method/header/configuration rejection or malformed transport input. A 200 tools/list response proves server-side completion of that request, but does not prove ChatGPT accepted its schema or response; these logs intentionally omit bodies. A 403 with no auth event can indicate the existing Origin gate, which runs before authentication. Do not enable verbose token/body/header tracing to investigate further.

## First ConnectWise Read

After Stage A authentication PASS, the CW administrator must verify the dedicated API member's read-only security role and provide the final URL, Company ID, public/private keys and Client ID outside the repository. Do not infer CW permissions from Entra or Descope identity. Add only service-specific configuration/secret references and restart/create the intended revision; retain auth settings and TLS verification.

Reinitialize/reconnect so the client refreshes its tool inventory: expect exactly 39 reads and no write handlers. Invoke **`cw_test_connection` once**, explicitly in ChatGPT, to execute the existing GET `/system/info` handler. Expected: successful system-info result under that member, with no mutation. If the member lacks that read permission, record the CW failure and use only an administrator-approved existing read tool; do not expand permissions or invent write tests. Do not record returned business/licensing data in general logs. The claim helper does not execute this read; perform it through the authorized ChatGPT/Inspector connection without raw payload logging.

Initialization/list must create no CW API traffic; rejected bearer requests must resolve no CW secrets and call no API. The current CLI environment provider cannot supply per-request counters; automated tests establish ordering, while live isolation is strengthened by Stage A having no credentials at all. Review CW audit/network evidence where available without adding raw payload logging. No Descope token is sent to CW, and no CW key is sent to ChatGPT/Descope.

## PASS Criteria

| Milestone | Required evidence |
| --- | --- |
| Deployment readiness | Actual AMD64 container build/run/scan; immutable image and correct settings; healthy warm replica and trusted ingress |
| Public discovery | Exact public PRM and safe 401 challenge work through final hostname; no anonymous MCP execution; genuine AS S256 discovery |
| Closed-gate bootstrap | No CW credentials; invalid/missing token 401; verified resource token 403 under `/exp`; no authorization bypass |
| Human identity | Real signed resource-token path reviewed as Rob's immutable human identity; another-user negative; refreshed/client-specific stability |
| ChatGPT Stage A | Real registration/code exchange and authorized initialize/list succeed without CW credentials; one diagnostic tool only |
| ChatGPT Stage B | Complete service-owned config; 39 reads/zero writes; one safe CW read succeeds |
| Persistence | Access expires, refresh succeeds with retained resource/scope/user restriction; console closed; revocation latency documented |
| Privacy/separation | No raw tokens/assertions/keys/data logs; no Monotorr auth/config sharing; no direct Entra/generic Descope token accepted |

Discovery-only or upstream SAML success is not end-to-end PASS. The deny-all bootstrap's expected 403 is not a successful ChatGPT connection. Production rollout remains separate from this controlled pilot.

## FAIL / Rollback Criteria

Immediately stop on unauthenticated access, acceptance of wrong issuer/audience/user, accidental write capability, secret/token disclosure, TLS bypass or impact to Monotorr routes. Stop before CW configuration on unidentified human claims, incompatible registration/resource flow, missing OAuth metadata, Origin failures or repeated discovery/linking failure. Image/startup/probe/production-audit failures also block deployment.

Rollback sequence for the operator:

1. For a compromised/bypassed gate or token exposure, disable this app's external ingress/approved edge routes immediately; do not rely only on app restart. Preserve unrelated Monotorr routes. Do not swap to an unauthenticated revision.
2. For ordinary identity/interop investigation, restore `MCP_APPROVED_USER_CLAIM=/exp`, fixed Rob ID and no CW credentials; deploy/restart that closed revision and confirm 401/403. This is closure, not a broader fallback.
3. Deactivate any failing/open revision or revision label; ensure no generated/label/default-host route reaches it. If a known-good protected revision exists, restore its digest/settings; on the first deployment there may be none, so take the service offline.
4. Remove pilot CW secret references/credentials from active revisions if added. Stop affected replicas; revision history does not itself revoke already exposed secrets. Any required broker consent/token revocation or CW key rotation needs separate authorization and owner coordination.
5. Restore DNS/edge bindings only to the recorded prior state with its owner, keeping certificate lifecycle and unrelated services intact. Confirm canonical and alternate hosts no longer execute MCP without the intended gate.
6. Record only sanitized failure categories, timestamps, revision/image identifiers and PASS/FAIL evidence. No HAR, SAML assertions or JWT dumps. Resume only after the defect and safe retest plan are reviewed.

## What Comes After PASS

Record the final verified claim pointer, actual registration method/callback mode, token/refresh lifetimes, issuer/audience/scope checks, CW permissions, deployment digest and approved revocation interval under repository `docs/`. Clear temporary Inspector/token material and return logs to the agreed minimal policy. Review production ingress limits, monitoring/redaction, secret rotation and container vulnerabilities before broader use.

Key Vault integration, setup/admin console, Copilot Studio, commercial tenancy and any changes to authentication architecture remain separately authorized work. **The repository is suitable for the manual controlled-deployment sequence, conditional on the outstanding image build/scan and actual Azure/DNS routing preflight. It is not yet approved for production use or guaranteed ChatGPT interoperability.** No application readiness defect requiring a code change was found in this review.
