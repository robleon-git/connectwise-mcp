# First controlled Azure / ChatGPT OAuth deployment

Prepared 2026-10-04 from canonical repository `/Users/rleon/Development/connectwise-mcp`, branch `phase1-hardening`, implementation commit `37203c3` (`Add Descope MCP authentication`). This is a manual runbook, not a deployment. No Azure/DNS/Descope/Entra changes, secrets or authentication code were added. Read alongside [Phase 1 hardening](PHASE1_HARDENING.md), [broker decision](MCP_AUTHORIZATION_BROKER_OPTIONS.md) and [Descope live-test evidence](CHATGPT_DESCOPE_MCP_LIVE_TEST.md).

**Decision:** use a separate Azure Container App for the existing container, keeping `https://api.monotorr.com/mcp`. First deploy without CW credentials and with the existing user gate deliberately closed. Determine a candidate human-identity claim using a real resource token in a local, non-authorizing diagnostic; then confirm that mapping through the real ChatGPT request. Only afterward add service-owned CW configuration for a controlled read. No application change is required for this sequence.

Startup review: `Dockerfile` builds UI and TypeScript on Node 26 Alpine, prunes development dependencies, runs as UID 1001 and starts `node dist/index.js`. It listens on `0.0.0.0:8080` with production HTTP/environment mode. Auth settings must validate before the socket is opened. The public JWKS is fetched on token verification, not startup; health does not prove JWKS/OAuth/CW readiness. `.env` is not automatically loaded. Azure must supply environment settings explicitly. Docker excludes real `.env` files/docs/Git; do not put any secrets in build arguments/context. Existing Compose templates do not forward the new auth settings and are **not** the Azure deployment path. Local Docker daemon access was sandbox-denied during this review; an image build/run/scan is still a manual preflight, not a claimed PASS.

Preparation verification: diagnostic Python/JavaScript syntax passed; an in-memory RSA/local-JWKS check confirmed the `/exp` gate returns 403 for both synthetic approved and other users; document links/whitespace and `git diff --check` passed. Only this document was added. The full application suite was not rerun because no application/build/configuration code changed.

## Pre-Deployment Checklist

- [ ] Confirm tenant/subscription access and the deployment operator; no new Entra OAuth app registration is required for our resource server.
- [ ] Record actual subscription ID, region, resource group/environment/app/registry names, image digest, DNS owner, existing `api.monotorr.com` routing and previous configuration. These cannot be inferred from this repository.
- [ ] Determine whether `api.monotorr.com` already serves Monotorr. Do not replace its DNS or routes without a reviewed routing plan. Sharing a hostname does not imply sharing application/configuration boundaries.
- [ ] Confirm ChatGPT account/workspace permits a private custom MCP connection; only Rob is participating. No public listing/sharing.
- [ ] Recheck real Descope discovery, upstream Monotorr SAML routing and approved-user record read-only. Do not change registration policies, clients or federation as part of preflight.
- [ ] Keep public HTTP authenticated; no `MCP_ALLOW_UNAUTHENTICATED_LOCAL=true`, static bearer fallback, direct Entra token validation, generic session tokens or metadata rewriting.
- [ ] Prepare the closed claim gate below; omit **all** `CW_MANAGE_*` credentials for Stage A. Do not source `.env.example` into a production shell.
- [ ] Approve any future Inspector installation/temporary OAuth client as test tooling separately. OAuth DCR may create a broker client as a normal connection side effect; no such action was performed in preparing this runbook.
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

For authenticated initialize/list/read, use the local safe prompt harness in the next section or Inspector. Do not put a token in `curl -H`, process arguments, environment files, shell history or HTTP query strings. Expected JSON-RPC bodies are:

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

Final `MCP_APPROVED_USER_CLAIM` is **unknown**. The earlier `/sub` suggestion was only a candidate; this runbook starts fully closed instead.

After separately authorizing local diagnostic tooling, use a pinned, reviewed MCP Inspector release on an operator-only loopback address against the same canonical MCP resource and real Descope AS. Complete **authorization-code/S256 resource OAuth** as Rob, not the SSO login preview. Inspect its token privately in the local client and copy only the **MCP access token** into the hidden prompt below. Never copy ID/refresh/session tokens. Protect any Inspector OAuth state persisted by that release, prevent recording/exports and remove temporary state after the test. Inspector uses its own client and does not prove ChatGPT client-specific claims. [Inspector](https://modelcontextprotocol.io/docs/tools/inspector).

The following local diagnostic authorizes nothing: it verifies signature/issuer/audience/time/scope, then reports only signed claim **paths** whose value equals the already known approved user ID. It does not dump claims, bearer text, names, emails, SAML data or key material. An empty match requires review; do not auto-select a path or broaden access. Confirm any match identifies the delegated human, rather than client owner/agent, and remains stable across refresh. A different-user negative must fail before the claim is accepted for the pilot.

Run from the canonical repo with the same six nonsecret auth settings set in your local operator process; `/exp` remains the closed-gate setting for the initial `claims` mode. `python3` needs a real terminal for `getpass`; abort if it warns that echo cannot be disabled. No new dependency or file is needed:

```sh
python3 - <<'PY'
import getpass, json, subprocess, warnings
warnings.simplefilter('error', getpass.GetPassWarning)
print('Mode [claims/initialize/list/read]: ', end='', flush=True)
with open('/dev/tty', 'r') as tty:
    mode = tty.readline().strip()
if mode not in ('claims', 'initialize', 'list', 'read'):
    raise SystemExit('Invalid mode')
token = getpass.getpass('Real MCP ACCESS token (hidden): ')
js = r'''
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { getDescopeMcpConfig } from './dist/auth/descope-mcp.js';
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { mode, token } = JSON.parse(input);
  const config = getDescopeMcpConfig();
  if (!config || typeof token !== 'string' || token.length > 16384) throw new Error();
  const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(config.jwksUri),
    { timeoutDuration: 5000 }), { issuer: config.issuer, audience: config.resourceUri,
    algorithms: ['RS256'], requiredClaims: ['iss', 'aud', 'sub', 'exp'] });
  if (typeof payload.scope !== 'string' || !payload.scope.split(' ').includes(config.requiredScope)) throw new Error();
  if (mode === 'claims') {
    const matches = [];
    function visit(value, path = '', depth = 0) {
      if (value === config.approvedUserId) { matches.push(path); return; }
      if (!value || typeof value !== 'object' || depth >= 5) return;
      for (const [key, child] of Object.entries(value)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /^\d+$/.test(key)) {
          visit(child, path + '/' + key, depth + 1);
        }
      }
    }
    visit(payload);
    console.log(JSON.stringify({ resourceTokenVerified: true, approvedIdMatchPaths: matches }));
  } else {
    const bodies = {
      initialize: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pilot-check', version: '1' } } },
      list: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      read: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'cw_test_connection', arguments: {} } }
    };
    const response = await fetch(config.resourceUri, { method: 'POST',
      redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify(bodies[mode]) });
    const body = await response.json();
    const tools = body.result?.tools;
    console.log(JSON.stringify({ status: response.status, hasRpcResult: Boolean(body.result),
      hasRpcError: Boolean(body.error), toolResultIsError: body.result?.isError === true,
      toolCount: Array.isArray(tools) ? tools.length : null,
      oauthMetadataMatches: Array.isArray(tools) ? tools.every(t =>
        JSON.stringify(t.securitySchemes) === JSON.stringify([{ type: 'oauth2', scopes: [config.requiredScope] }]) &&
        JSON.stringify(t._meta?.securitySchemes) === JSON.stringify(t.securitySchemes)) : null }));
  }
} catch {
  console.error('Diagnostic failed; sensitive details suppressed.'); process.exitCode = 1;
}
'''
subprocess.run(['node', '--input-type=module', '-e', js],
               input=json.dumps({'mode': mode, 'token': token}), text=True, check=True)
PY
```

Token is passed through an anonymous stdin pipe, not argv/environment/files. Local process memory and clipboard still contain it temporarily; use a trusted workstation, clear clipboard and terminate diagnostic/Inspector sessions afterward. Do not redirect output to external project directories. Run `initialize`, `list`, `read` modes only after the approved identity path is verified/configured; HTTP summaries never print CW payloads or raw auth response objects.

This diagnostic is a **candidate discovery**, not authorization: its verification omits the user decision on purpose but never invokes MCP in `claims` mode. For a valid closed-gate token, `/mcp` must still return 403. Set the final JSON Pointer only after reviewed human-identity evidence; keep Rob's ID exact. Repeating ChatGPT with that pointer and getting successful initialize demonstrates the actual ChatGPT token contains the approved value at that path. If Inspector works but ChatGPT gets 403, client-specific issuance is unverified; stop. If no trustworthy stable human claim exists, stop for a separately reviewed claim-mapping implementation; do not add an accepts-all diagnostic mode.

## First ConnectWise Read

After Stage A authentication PASS, the CW administrator must verify the dedicated API member's read-only security role and provide the final URL, Company ID, public/private keys and Client ID outside the repository. Do not infer CW permissions from Entra or Descope identity. Add only service-specific configuration/secret references and restart/create the intended revision; retain auth settings and TLS verification.

Reinitialize/reconnect so the client refreshes its tool inventory: expect exactly 39 reads and no write handlers. Invoke **`cw_test_connection` once**, explicitly in ChatGPT, to execute the existing GET `/system/info` handler. Expected: successful system-info result under that member, with no mutation. If the member lacks that read permission, record the CW failure and use only an administrator-approved existing read tool; do not expand permissions or invent write tests. Do not record returned business/licensing data in general logs. The local harness reports only status and result/error flags.

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
