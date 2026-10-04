# ConnectWise MCP repository and security architecture review

Reviewed October 4, 2026. Repository: `robleon-git/connectwise-mcp`, default branch `main`, commit [`7629ede790f799df395a7f49a0352953d4046c1d`](https://github.com/robleon-git/connectwise-mcp/tree/7629ede790f799df395a7f49a0352953d4046c1d). Declared application version: 1.4.0; the commit includes subsequent unreleased changes.

**Assessment:** Useful foundation for the intended Azure service, but unsuitable for production as-is. It exposes 55 tools, including 16 that can write or delete. Remote endpoint authentication is disabled by default. No application runtime dependency on WYRE-hosted infrastructure was found; build/release workflows retain significant WYRE dependencies.

Scope: all 75 tracked files in this snapshot, including application/UI source, generated UI bundle, tests, dependency lockfile, manifests, documentation, deployment files and workflows. The three directly referenced reusable CI workflows were also inspected at their pinned commits. This is a source/dependency review with mocked checks, not a penetration test or an exhaustive audit of dependency/action internals, historical commits, published images or running infrastructure.

The supplied local workspace was an empty Git repository with no commits or remotes. GitHub confirms the fork parent is `WYRE-AI/connectwise-manage-mcp`; the user's `upstream` configuration could not be independently confirmed in this workspace. Review execution used a separate temporary clone. No application source, configuration, Git remotes or Azure resources were changed. This report is the only workspace addition.

## 1. Architecture

| Aspect | Inherited implementation |
|---|---|
| Language/runtime | TypeScript, strict checking, ESM; compiled by `tsc` to ES2022 JavaScript. `package.json` claims Node >=20.18.1, Docker uses `node:26-alpine`, and locked Undici requires Node >=22.19.0. The declared minimum is inconsistent with the dependencies. |
| Node entry point | `src/index.ts` → `dist/index.js`; npm CLI executable `connectwise-manage-mcp`, or `npm start`. |
| Worker entry point | `src/worker.ts`, selected by `wrangler.json`; a separate Cloudflare handler with a different security feature set. |
| MCP transports | Local stdio by default; Node HTTP when `MCP_TRANSPORT=http`; Workers use Web Standard Streamable HTTP. HTTP is stateless, with a fresh server/transport per request and JSON responses. Node exposes POST `/mcp`; GET/DELETE return 405. No separate legacy `/sse` transport is implemented. |
| Tool registration | `createMcpServer()` calls 13 area-specific registration functions. Tools use MCP SDK `server.tool()` / `registerTool()` and Zod schemas. All 55 register when credentials exist; no navigation tree, lazy loading or read-only switch. Without credentials, only a diagnostic `cw_test_connection` registers. |
| API client | Shared `CwManageClient`; Node global `fetch`, Basic auth encoding `companyId+publicKey:privateKey`, plus `clientId` header. Appends `/v4_6_release/apis/3.0` unless the configured URL contains `/v4_6_release/`. Implements GET/POST/PATCH/DELETE; JSON request and response bodies. |
| Pagination/resilience | Explicit page/pageSize, usually default 1/25. No automatic traversal, retry/backoff, application timeout or circuit breaker. Described page-size maximums are generally not enforced by schemas. |
| UI/resource | One embedded resource, `ui://connectwise-manage/ticket-card.html`, built with Vite and MCP Apps. `cw_get_ticket` also reads five recent notes, including internal notes, and attaches a `_card` to its model-visible JSON. The card can call `cw_add_ticket_note`. |
| State/storage | No application database or persistent credential store. Credentials and request data reside in process memory; tool results are sent to the MCP client. Logs primarily use stderr. `LOG_LEVEL` and `/app/logs` are advertised but there is no application log-level filtering or file logger. |

Configuration precedence is an explicit per-request configuration override, otherwise `process.env`. Environment mode requires `CW_MANAGE_COMPANY_ID`, `CW_MANAGE_PUBLIC_KEY`, `CW_MANAGE_PRIVATE_KEY`, and `CW_MANAGE_CLIENT_ID`; `CW_MANAGE_URL` otherwise defaults to the North American ConnectWise cloud. Gateway mode requires all four equivalent `X-CW-*` headers and accepts optional `X-CW-Url`. Overrides are isolated per request without changing global credentials. `.env` loading is performed by Compose, not by a dotenv loader in Node.

Docker builds TypeScript in one stage, copies compiled output and dependencies into another, prunes development dependencies, runs as UID 1001, and defaults to HTTP on port 8080. `/health` is a shallow liveness response, not proof that credentials, permissions or ConnectWise connectivity work. Plain Compose exposes 8080; optional Caddy Compose terminates HTTPS on 443. Azure Container Apps and Key Vault are already described in deployment documentation; DigitalOcean and Cloudflare deployment templates also exist.

Sources: [entry point](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/index.ts), [server factory](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/mcp-server.ts), [API client](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/api-client.ts), [Dockerfile](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/Dockerfile).

## 2. Complete MCP tool inventory

Classification follows actual API methods and behavior, not tool names or descriptions. **55 total: 39 read-only, 10 creates data, 5 modifies data, 1 deletes data.** The README's count of 53 is stale. The diagnostic fallback does not add a 56th tool.

| ConnectWise area | Read-only | Creates data | Modifies data | Deletes data |
|---|---|---|---|---|
| Service tickets | `cw_search_tickets`, `cw_get_ticket`, `cw_get_ticket_notes` | `cw_create_ticket`, `cw_add_ticket_note` | `cw_update_ticket` | — |
| Companies | `cw_search_companies`, `cw_get_company` | `cw_create_company` | `cw_update_company` | — |
| Contacts | `cw_search_contacts`, `cw_get_contact` | `cw_create_contact` | — | — |
| Projects and project tickets | `cw_search_projects`, `cw_get_project`, `cw_search_project_tickets`, `cw_get_project_ticket`, `cw_get_project_ticket_notes` | `cw_create_project`, `cw_add_project_ticket_note` | — | — |
| Time | `cw_search_time_entries`, `cw_get_time_entry` | `cw_create_time_entry` | `cw_update_time_entry` | `cw_delete_time_entry` |
| Members/technicians | `cw_search_members`, `cw_get_member` | — | — | — |
| Configurations/assets | `cw_search_configurations`, `cw_get_configuration` | — | — | — |
| Service reference data | `cw_list_boards`, `cw_list_priorities`, `cw_list_statuses` | — | — | — |
| Activities | `cw_search_activities`, `cw_get_activity` | `cw_create_activity` | — | — |
| Product catalog/procurement | `cw_search_catalog_items`, `cw_get_catalog_item`, `cw_list_catalog_categories`, `cw_list_catalog_subcategories`, `cw_list_manufacturers` | `cw_create_catalog_item` | `cw_update_catalog_item` | — |
| Agreements | `cw_search_agreements`, `cw_get_agreement`, `cw_get_agreement_additions` | `cw_create_agreement_addition` | `cw_update_agreement_addition` | — |
| Invoices | `cw_search_invoices`, `cw_get_invoice` | — | — | — |
| Opportunities/sales pipeline | `cw_search_opportunities`, `cw_get_opportunity`, `cw_search_opportunity_forecasts`, `cw_search_opportunity_notes`, `cw_search_sales_stages` | — | — | — |
| System/connectivity | `cw_test_connection` | — | — | — |

No exposed generic tool accepts an arbitrary REST path or HTTP method. The general `request()` method exists internally but is not registered as an MCP tool. Nevertheless:

- Update tools accept arbitrary JSON Patch field paths within their target entity, including `remove`; they are broader than the example fields suggest. `cw_update_ticket` can alter notification settings and other API-supported ticket fields.
- `cw_create_catalog_item.extraFields` passes arbitrary catalog fields through and can override explicitly constructed fields.
- Search tools accept broad ConnectWise `conditions`, ordering and sometimes child conditions; these are queries passed to ConnectWise, not local SQL execution. They do not impose per-user company/board restrictions.
- `cw_get_ticket` reads notes as well as ticket details. Ticket-note tools may include child-ticket notes and internal content. Configuration, agreement, invoice and member reads return whole API objects without a sensitive-field filter.
- `cw_update_agreement_addition` is a write tool even though `dryRun=true` performs only a GET and local preview; the default is a live PATCH.
- `cw_add_ticket_note` can cause ConnectWise to email contacts/resources/arbitrary CC addresses when flags or `processNotifications` request it. The application itself does not send SMTP mail. Other ConnectWise workflow side effects depend on instance configuration.

All tools currently lack MCP behavior annotations, including `readOnlyHint`. Inventory source: [all tool modules](https://github.com/robleon-git/connectwise-mcp/tree/7629ede790f799df395a7f49a0352953d4046c1d/src/tools).

## 3. Security review

### Credentials and endpoint authentication

ConnectWise keys arrive through environment variables, Compose `.env`, desktop client configuration/MCPB settings, Worker secrets, or gateway headers. The client retains a reversible Base64 Basic-auth value in memory. There is no Key Vault client, encryption-at-rest layer or secret rotation logic in the application. `.env` is Git-ignored and excluded from Docker builds; no apparent live ConnectWise credentials were found in the reviewed snapshot. This does not certify Git history or external secret stores. MCPB marks the API keys and client ID sensitive, but storage security is delegated to the desktop host.

**`AUTH_MODE=env` selects a credential source; it does not authenticate MCP callers.** With OAuth disabled and no S2S secret, anyone who can reach `/mcp` can use every registered tool under the configured ConnectWise API member's permissions. The example configuration and Docker defaults leave OAuth disabled. HTTPS does not resolve this authorization gap.

The Node HTTP entry point optionally offers:

- Entra JWT validation when `MCP_OAUTH_ENABLED=true`: remote Microsoft JWKS, signature/issuer/audience checks, and required app role (`CWM.Access` by default). JWT time claims are checked by `jose` when present; this wrapper does not explicitly require an `exp` claim or delegated scope. Accepted audiences include configured audience, client GUID, `api://<clientId>`, and optional extra audiences.
- A static `MCP_BEARER_TOKEN` fallback, **only inside the OAuth-enabled path**. Supplying that variable alone does not protect an OAuth-disabled server. A matching token bypasses Entra user/role validation and is logged as `cli-user`; it has no built-in expiry or individual attribution.
- Optional Conduit `X-Gateway-S2S` verification if `CONDUIT_S2S_SECRET` is set. HMAC covers only a timestamp, valid within ±300 seconds, not method/path/body/credential headers; no nonce/replay cache exists. It authenticates knowledge of a shared key, not an end user. It makes no outbound Conduit call.

**Workers do not implement the Node Entra, static-token or S2S checks.** The OAuth-looking variables in `wrangler.json` do not activate authentication in `src/worker.ts`. Workers also return wildcard CORS headers. Their environment mode with real credentials needs an independent access-control layer before public exposure.

### Material findings

| Priority | Finding and implication |
|---|---|
| Critical deployment blocker | Public HTTP can be unauthenticated while holding powerful ConnectWise credentials. A reachable default deployment exposes reads, writes and deletion. |
| High | No Phase 1 capability enforcement: all 16 write/delete tools are callable; the ticket card provides an additional note-writing UI. Hiding tools only in ChatGPT would not secure the service. |
| High | No authorization by user/company/board/record. After the coarse Entra role check, identity is logged and discarded; all authorized users share the ConnectWise API member's access. This is workable only for a deliberately trusted staff group whose access matches that member. |
| High, gateway mode | `X-CW-Url` accepts arbitrary destinations, including HTTP/private addresses; no URL/host/egress allowlist. This enables server-side requests to unintended services and sends the supplied keys there. All four supplied credentials are required, so the reviewed implementation does not automatically combine an arbitrary header URL with environment-held keys. Environment URLs also lack HTTPS enforcement. |
| High | Raw ConnectWise error bodies become MCP tool error text. Sensitive API responses or reflected inputs can reach ChatGPT. Entra token-exchange errors log complete error bodies. Caddy's access logs do not explicitly redact custom `X-CW-*` headers. |
| Medium/high | No Origin/Host policy. The SDK's DNS-rebinding protection defaults to false and is not enabled here. A mocked Worker request with an untrusted Origin succeeded. MCP requires Origin validation when provided. [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). |
| Medium/high | No application request-rate/concurrency limits or outbound API timeout; MCP bodies are parsed with unbounded `request.json()` in the reviewed SDK path. OAuth routes have a separate 64 KiB limit. Broad searches/large responses can exhaust capacity or overload ConnectWise. |
| Medium | TLS verification can be disabled for ConnectWise by `CW_MANAGE_REJECT_UNAUTHORIZED=false`. It is correctly scoped to a client Agent rather than globally disabled, but remains unsafe for production internet traffic. Custom Agents are not explicitly disposed. |
| Medium | OAuth adapter needs protocol review: `/register` returns one pre-existing client ID and echoes redirects rather than registering distinct clients; Entra's redirect allowlist is the ultimate guard. `/authorize` rewrites scopes/client ID; `/token` removes `resource` and forwards other parameters. There is no local client registry or comprehensive grant/PKCE/resource policy. This is not evidence of a proven Entra bypass, but it is not a production compatibility/security proof. |

Logs normally include startup configuration, tenant/role metadata, user UPN and timestamps, failed-role lists and an unverified JWT audience diagnostic—not deliberate API-key or full-token logging. However, there is no general redaction policy, and exception objects, upstream error bodies, proxy header logs and deployment shell output are exposure paths. Caddy redacts standard Authorization/Cookie headers by default; custom ConnectWise headers require their own filtering. [Caddy logging documentation](https://caddyserver.com/docs/caddyfile/directives/log).

Successful tool payloads are not normally logged. The Azure guide's claim that all tool calls are audited is overstated: application audit lines record an authenticated POST `/mcp`, not tool name, arguments, record IDs or outcome. `/health` stays unauthenticated and shallow. No persistent application cache was found.

Sources: [Node endpoint](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/index.ts), [Worker endpoint](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/worker.ts), [JWT middleware](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/auth/middleware.ts), [OAuth routes](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/auth/routes.ts), [S2S verifier](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/src/s2s-verify.ts).

## 4. External communications and privacy

The table separates application egress from optional UI/deployment/build behavior. This is the complete destination set identifiable in the reviewed repository and directly referenced workflows; DNS, certificate validation and nested third-party actions can involve additional infrastructure whose exact hosts are not fixed here.

| Destination | Trigger and data involved |
|---|---|
| `login.microsoftonline.com` | Optional Node Entra mode fetches public signing keys. `/token` posts OAuth exchange parameters, including authorization codes/PKCE verifiers or refresh tokens; Microsoft returns tokens. `/authorize` redirects the user's browser to Microsoft with login/flow metadata. No deliberate ConnectWise record/key transmission to Microsoft was found in this path. |
| Caller-selected `X-CW-Url` | Gateway mode sends the supplied ConnectWise authentication and API request to this URL. It can differ from the intended ConnectWise server, so arbitrary egress is possible. |
| Configured `MCP_BRAND_LOGO_URL` | Ticket UI assigns this to an image URL. If host CSP permits, the client browser fetches it, disclosing ordinary request/network metadata; no explicit ticket/key payload is attached. Neutral UI has no external fonts or fixed vendor asset requests. The embedded Vite preload helper can fetch referenced assets, but the current card is bundled into one document. |
| MCP client, including ChatGPT | ConnectWise data, internal notes, tool results and raw error text are returned over the incoming MCP connection. This is the intended data disclosure to OpenAI in the proposed architecture, even though the app makes no outbound OpenAI SDK call. |
| Let's Encrypt / ZeroSSL ACME services | Optional Caddy HTTPS stack obtains/renews certificates, communicating hostname/account metadata. Default CA behavior comes from Caddy, not hardcoded application calls. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https). |
| GitHub/GitHub APIs, `npm.pkg.github.com`, `ghcr.io`, public `registry.npmjs.org`, Docker image registries | Source/actions/package/image download and optional publishing. All explicit lockfile download URLs use the public npm registry. CI authenticates to GitHub services; inherited Compose/Azure alternatives reference WYRE's GHCR image. Node/Caddy base-image pulls use Docker registry infrastructure. Tooling such as npm may perform update checks; no application update checker was found. |
| WYRE GitHub repositories/project | Reusable release/assertion/project workflows run WYRE-maintained code. `add-to-project` uses a GitHub App key if provided and targets `wyre-technology` project 1. Release targets `ghcr.io/wyre-ai/connectwise-manage-mcp`; `mcp-assert` calls a WYRE evaluation action. Release and project callers use `secrets: inherit`. This creates external code/secret trust, not proof that secrets are transmitted to a WYRE web server. |
| Anthropic services | Optional `@claude` workflow passes `CLAUDE_CODE_OAUTH_TOKEN` to `anthropics/claude-code-action`, allowing AI processing of repository/issue/PR context. It is development-time behavior, not application telemetry. Exact API routing is in the action, outside this repository. |
| `registry.modelcontextprotocol.io`; signing/scanning infrastructure | Inherited release workflow publishes server metadata and uses GitHub OIDC, downloads/verifies publisher tools with Sigstore, scans the image with Trivy, and uploads security results to GitHub. Exact nested tool/download endpoints need separate tracing. |
| Azure control plane, ACR, Key Vault, Log Analytics; optional Cloudflare/DigitalOcean | Deployment documentation/templates direct resource management, image pulls, secret retrieval and log collection to those selected providers. No Azure telemetry SDK is initialized by application code. DigitalOcean marks keys `RUN_AND_BUILD_TIME`, unnecessarily exposing them to the build environment too. |
| Documentation/display links | `conduit.wyre.ai` is repository homepage metadata; WYRE/GitHub links, Smithery/Glama schema URLs, deployment buttons, badges (`img.shields.io`, `www.deploytodo.com`, Cloudflare), support links and other documentation references are not server-runtime callbacks. Rendering/clicking them can contact those sites. Historical changelog references to Discord do not establish a current Discord webhook. |

**No application telemetry, analytics, error-reporting SDK, phone-home/update check, or fixed WYRE-hosted API call was found. No code deliberately forwards ConnectWise credentials, records or tool-call logs to WYRE for analytics was found.** The runtime uses public packages, not a private WYRE API-client package.

That is “not found in this review,” not “provably impossible.” Arbitrary gateway URLs, optional logo requests, tool-triggered ConnectWise emails, dependencies, CI actions, a substituted upstream image, hosting log collection and future changes remain relevant. Strict egress controls and deployment-owned builds are needed to make the intended destination policy enforceable.

Workflow sources: [fork workflows](https://github.com/robleon-git/connectwise-mcp/tree/7629ede790f799df395a7f49a0352953d4046c1d/.github/workflows), [pinned release workflow](https://github.com/WYRE-AI/reusable-workflows/blob/2b0b056bd7544937e5cbd56cf2e1ff8a180a411f/.github/workflows/mcp-server-release.yml), [pinned project workflow](https://github.com/wyre-technology/.github/blob/692c0d01979dfe2a2738d71dbf20a3b47a3bb014/.github/workflows/auto-add-to-project.yml), [pinned assertion workflow](https://github.com/wyre-technology/.github/blob/7542c27000cf8d213c4910b4f397637b105a718b/.github/workflows/mcp-assert.yml).

## 5. Dependencies and verification

| Important package | Locked version | Role / assessment |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.30.0 | MCP protocol, registration and transports; core dependency. Brings networking, auth and schema packages transitively. |
| `jose` | 6.2.10 | JWT/JWKS authentication; important for Entra mode. No separate secret-store integration. |
| `undici` | 8.10.0 | HTTP Agent for relaxed ConnectWise TLS; normal requests use Node's built-in fetch. Requires Node >=22.19.0. If verified TLS is mandatory, reassess the need for its current standalone use. |
| `zod` | 4.3.6 | Tool input validation; directly imported by source but available only through SDK dependency resolution. Should be declared directly. |
| `@hono/node-server`, `hono` | 1.19.9, 4.11.9 | SDK HTTP adapter/networking. Adapter is used by the Node transport; much broader Hono middleware functionality is not used directly. |
| `express`, `cors`, `express-rate-limit`, EventSource packages | Express 5.2.1; others in lockfile | SDK networking/transport support. Their presence does not mean this app enables Express authentication, CORS or rate limiting. |
| `ajv`, `fast-uri` | 8.18.0, 3.1.7 | SDK schema/URI validation. Recent override fixes older advisories, but current audit still flags `fast-uri`. |
| `@modelcontextprotocol/ext-apps` | 1.7.5, development dependency | Browser MCP Apps bridge bundled into the committed UI; therefore affects a shipped runtime artifact despite development classification. |
| TypeScript, ESLint/typescript-eslint, Vitest | See lockfile | Build, lint and tests; not intended production services. |
| Vite, `vite-plugin-singlefile` | Vite 8.2.2; plugin 2.3.3 | Embedded UI build; review bundle freshness/security after dependency changes. |
| `semantic-release` and plugins | Release 25.0.9 | GitHub publishing/release automation; substantial build-only dependency tree. `@semantic-release/git` is installed but not configured; desktop packaging and release tooling are optional for an Azure-only use case. |

No dedicated logging, telemetry, dotenv or Azure Key Vault package is installed directly. No important direct package was established as abandoned; the recent source/Dependabot activity shows maintenance but is not a security guarantee. `npx mcpb` is not locally pinned; the inherited release workflow globally installs its CLI without a version pin. Docker's mutable base tags and upstream `latest` image references also reduce reproducibility.

Live npm audit of the locked graph on the review date:

- **Production:** 9 flagged packages: **6 high, 2 moderate, 1 low, 0 critical**. High: `@hono/node-server`, `express-rate-limit`, `hono`, `ip-address`, `path-to-regexp`, `undici`; moderate: `fast-uri`, `qs`; low: `body-parser`. npm reports fixes available for all nine.
- **Full graph:** 33 flagged packages: **2 critical, 25 high, 4 moderate, 2 low**. Critical packages are `handlebars` and `tar` in development/release tooling; they are not in the production-only count.
- Counts represent affected package entries, not distinct exploits. Many advisories concern unused middleware/static-file/WebSocket/cache features. Reachability must be assessed; the findings do not establish all are exploitable through `/mcp`. The reviewed Undici usage also differs from Node's separately bundled fetch implementation. [Maintainer Undici advisory example](https://github.com/nodejs/undici/security/advisories/GHSA-3xpg-4rpp-hhhm).

Verification in the temporary clone: locked install with lifecycle scripts disabled; TypeScript build and lint passed; **7 source test files / 77 tests passed**, with ConnectWise fetches mocked. Running the default test command after building executes source and compiled test copies, reporting 154 passes; the unique source count is 77. Tests cover Worker MCP flow, notes/search/patch behavior, UI payloads, TLS isolation and mocked JWT validation, but do not prove live Node HTTP OAuth or ChatGPT compatibility.

Additional mocked checks confirmed 55 advertised tools, zero behavior annotations, successful Worker access without a bearer token, acceptance of an untrusted Origin, a gateway request aimed at a private HTTP address, and propagation of a synthetic sensitive error body into the MCP response. No real ConnectWise service was contacted. Docker/Cloudflare/Azure deployment and published-image scanning were not performed.

Sources: [package declarations](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/package.json), [lockfile](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/package-lock.json).

## 6. Licensing

The repository declares **Apache License 2.0**, confirmed by `LICENSE`, `package.json` and distribution manifests. No separate root NOTICE, COPYRIGHT or AUTHORS file, or populated project copyright header, was found; `LICENSE` retains the standard appendix's placeholder copyright line. Origin/author attribution exists in README, package metadata, manifests and Docker labels. Preserve applicable source attribution when distributing derivatives; operational URLs and product branding can be changed without removing the historical origin credit.

Commercial use and proprietary modifications are allowed. On redistribution, provide Apache 2.0, mark changed files prominently, retain applicable source notices, and reproduce relevant NOTICE content if present in the distributed work/dependencies. Apache 2.0 does not require publishing modifications merely because you operate a hosted service. Its patent grant/termination and lack of trademark permission still matter; a fork should not imply WYRE endorsement. [Apache 2.0 terms](https://www.apache.org/licenses/LICENSE-2.0.html).

Dependency obligations are separate. Runtime lockfile metadata lists MIT, ISC and BSD licenses; the embedded UI and final image need their actual notices preserved too. `.dockerignore` excludes the root `LICENSE`, and the production Dockerfile copies only package files, `dist` and `node_modules`, so the application license is not explicitly included in that image. Desktop pack script does copy it. Plan a license/notice inventory for any commercial distribution, including the bundled browser bridge. [Repository license](https://github.com/robleon-git/connectwise-mcp/blob/7629ede790f799df395a7f49a0352953d4046c1d/LICENSE).

## 7. Azure suitability for the proposed architecture

The proposed flow is feasible:

```text
ChatGPT ── HTTPS + user OAuth ──> api.monotorr.com/mcp
                                      │
                           Azure HTTPS ingress
                                      │
                         Dedicated Node MCP container
                              │               │
                    HTTPS to on-prem      Managed identity
                    ConnectWise API       → Key Vault references
```

**Recommended deployment starting point:** a dedicated Azure Container App using your own built image in ACR, with HTTPS/custom-domain ingress mapped to port 8080. Existing stateless request handling is suitable for replicas and needs no session database or mandatory WYRE gateway. Sharing a tenant does not require sharing an application identity, permissions or resource lifecycle with existing services. App Service containers are also technically possible; this repository already documents Container Apps, so that is the least novel route.

Key Vault integration can be performed through Container Apps secret references and managed identity, projecting values into the existing `CW_MANAGE_*` environment variables; no application Azure SDK is necessary for that approach. Grant narrowly scoped secret access and ACR pull access. Nonsecret configuration can remain ordinary environment variables. Versionless Key Vault references support rotation; version-specific references deliberately stay pinned. [Microsoft Container Apps secrets documentation](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets).

For this single ConnectWise instance, use environment mode rather than caller-provided ConnectWise keys/URLs. Set the intended on-prem API URL explicitly, require trusted TLS, and ensure Azure DNS/egress can reach it. If the on-prem firewall restricts source IPs, establish stable Azure egress and allowlist it. Account for Entra/Key Vault/registry infrastructure separately from data-plane ConnectWise access. No VPN is inherently required by the stated publicly accessible API, though its firewall/certificate topology still needs validation.

ChatGPT needs a reachable remote MCP endpoint with working authentication discovery and an OAuth authorization-code/PKCE integration for private data. Do not assume the inherited Claude-oriented proxy works unchanged: its simulated registration, shared client ID, scope rewriting and removed `resource` parameter differ from current documented expectations. Use the exact ChatGPT callback URI shown for your connection, not the repository's Claude callback. ChatGPT cannot be assumed to send the repository's custom `X-CW-*` headers or static API token. [Official OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth), [remote MCP deployment guidance](https://developers.openai.com/plugins/build/mcp-server).

The Node Entra verifier is reusable, but the OAuth/client-registration boundary must be chosen and verified before deployment—either a corrected MCP-compatible adapter using Entra, or another suitable authorization layer backed by your tenant. Keep user identity tokens separate from the backend ConnectWise credentials. A browser-only Azure login redirect by itself is not an MCP OAuth integration.

The existing Azure guide is a starting point, not an executable production specification:

- It enables OAuth while initially omitting `MCP_SERVER_URL`, claiming the server starts with a localhost default. Current `getEntraConfig()` instead throws when that variable is absent. Your intended public origin is already known: `https://api.monotorr.com`.
- It claims versioned Key Vault URIs are required. Azure supports both; updating a secret then redeploying the same image does not update a reference pinned to the old secret version.
- `/health` returning 200 does not prove Key Vault values are complete or ConnectWise authentication works.
- Commands can display returned secret values or explicitly print a new bearer token. The guide's assurances about no secrets in shell history/output are too strong.
- It creates a new resource group and later offers deletion/purge steps; those must not be copied into an existing tenant deployment without resource ownership boundaries.
- It offers upstream GHCR `latest`, Claude callback configuration and incomplete tool-call audit claims. Use your own build/registry, ChatGPT-specific connection settings and explicit Azure probes.

No Azure resources or authentication changes were implemented during this review.

## 8. Recommended Phase 1 changes — do not implement yet

| Order | Change | Reason / acceptance criterion |
|---|---|---|
| P0 — 1 | Enforce server-side read-only operation while retaining all 39 useful read tools. Remove/disable registration and execution of all 16 write/delete tools; remove the card's Add note path. Add a backend guard rejecting non-GET ConnectWise calls. | Direct calls to every former write tool must fail before any outbound write. UI and model settings alone are insufficient. Disable agreement updates even with optional dry-run support. |
| P0 — 2 | Provision a dedicated least-privilege read-only ConnectWise API member. | ConnectWise itself rejects create/update/delete. Establish approved data areas/companies/boards; do not grant administrator access just to avoid permission errors. |
| P0 — 3 | Require MCP authentication, fail closed on missing production auth config, and complete ChatGPT-compatible OAuth/Entra authorization. Avoid the shared static-token fallback for Phase 1. | Anonymous, wrong-tenant, wrong-audience, expired and unassigned-user requests fail. Assigned staff succeed. Confirm deliberate group-wide access or implement narrower per-user policy. |
| P0 — 4 | Make build/deploy ownership independent of WYRE. Replace inherited reusable workflows/project automation and broad secret inheritance; build your own pinned image into ACR. Disable unneeded Anthropic automation. | Deployment never consumes upstream `latest`, publishes to WYRE's registry/project, or executes WYRE-controlled release/evaluation code with your secrets. Retain upstream as a read-only maintenance source. |
| P0 — 5 | Supply keys from Key Vault via managed identity; fix the ConnectWise destination in server configuration and enforce HTTPS/host policy. Keep gateway overrides disabled for this service. | Keys are absent from ChatGPT settings, Git, image layers and logs; URL overrides cannot redirect backend access. Test key rotation and old-key revocation. |
| P0 — 6 | Remediate dependency advisories and align the supported Node runtime with the lockfile/container; scan the actual image and embedded UI dependencies. | Reproducible supported build, documented advisory reachability/remediation, and no unexplained critical/high findings in the deployment path. Declare Zod directly. |
| P1 — 7 | Review returned fields and internal notes, redact secrets/sensitive configuration fields, and sanitize API/OAuth errors and custom-header logs. | Preserve tool breadth while preventing unintended credential/PII disclosure. Decide explicitly which finance/personnel/internal-note data ChatGPT may receive. |
| P1 — 8 | Add Origin/Host policy, request/response limits, API deadlines, bounded concurrency/rate limiting, and careful read-only retry handling. | Invalid-origin and oversized requests fail safely; slow/429/unavailable ConnectWise does not exhaust the service. Protect Node endpoint behavior separately from Worker tests. |
| P1 — 9 | Add structured minimal audit records and accurate readiness checks; add read-only annotations to retained tools. | Record authenticated principal, tool, time, outcome and correlation ID without arguments/results/secrets by default. Prove credential/config readiness separately from liveness. |
| P1 — 10 | Replace stale Azure/Claude deployment guidance with a reviewed tenant-specific plan and complete staged verification. | Verify initialize/list/call/resource flows from ChatGPT, auth failures, permissions, read-only enforcement, TLS, egress, rotation and logs against a safe test instance before production. Include licenses in distributed artifacts. |

This preserves read-only functionality across tickets, companies, contacts, projects, time, members, assets, service reference data, activities, catalog, agreements, invoices and opportunities. Any further restriction should follow actual data permissions or a documented compatibility limitation, not an arbitrary tool-count target. Copilot-specific identity/audience expansion can remain a later phase.

## 9. Questions and unknowns

- What exact ConnectWise version/API surface, public hostname/path, certificate chain and API-member permissions are available? Do internal notes or configuration records contain passwords, recovery keys or regulated data?
- Which staff/groups may use the service, and should all of them have the same ConnectWise visibility? Are company/board restrictions required per user?
- What ChatGPT plan/workspace/admin permissions and connection mode will be used? Actual callback URI, OAuth interoperability and tool/UI behavior must be established in a live staging connection.
- Which Azure subscription, resource group, Container Apps environment, ACR, Key Vault, identity, region and ingress resources can be reused? Who owns their lifecycle and log access?
- Are stable outbound IPs, an on-prem source allowlist, private DNS, additional reverse proxies or customer-domain routing already in place?
- What are the privacy/retention/residency rules for ConnectWise records sent to ChatGPT and operational logs stored in Azure? Which returned fields need filtering?
- What GitHub Actions are enabled on the fork, what secrets are available to them, and what branch protections/permissions exist? The snapshot does not establish organization settings or historic secret exposure.
- Do published upstream images/packages correspond to this commit? Their contents, provenance and runtime traffic were not verified. Nested actions and all third-party source code were not exhaustively reviewed.
- Which live dependency advisories are reachable in this exact production configuration? npm audit is a signal, not an exploitability assessment or a container/OS scan.
- Do inherited note-email claims match actual ConnectWise automatic notification workflows? This matters for future write phases, though all note writes should be disabled in Phase 1.
- How should Key Vault rotation, API-key revocation, patch ownership, incident response, operational alerts and usage limits work?
- The stated upstream remote may exist in another checkout, but cannot be verified from the empty local workspace supplied for this review. No remotes were changed.

## Would I deploy this against a production ConnectWise instance as-is?

**No.** The default remote service can expose a credentialed ConnectWise account without caller authentication, registers write/delete capabilities, returns unfiltered records and raw errors, and lacks essential public-endpoint controls. The dependency graph has unresolved advisories, inherited CI depends on WYRE-owned workflows, and the existing OAuth/Azure instructions do not establish a working, secure ChatGPT integration. It is a useful starting point once read-only enforcement, least-privilege credentials, tenant-backed authentication, controlled Azure deployment and staged verification are complete.
