# Phase 1 hardening

Implemented against reviewed upstream commit `7629ede790f799df395a7f49a0352953d4046c1d`. No deployment, Azure resources, Key Vault integration, new identity protocol, or commit was performed. This service remains independent of Monotorr: no Monotorr code, database, credentials, tenancy, or billing integration was added.

## Read-only surface

| Capability | Before | After |
| --- | ---: | ---: |
| Read tools with configured CW credentials | 39 | 39 |
| Create tools | 10 | 0 |
| Modify tools | 5 | 0 |
| Delete tools | 1 | 0 |
| Total configured tools | 55 | 39 |

All 16 write registrations and handlers were removed from their area modules. Unknown-tool calls fail without contacting ConnectWise. The low-level client additionally rejects every method except GET. Existing pure note/patch helpers remain for regression coverage but are not MCP tools and cannot call the API. Without service credentials the existing single diagnostic tool remains.

Removed: `cw_create_ticket`, `cw_add_ticket_note`, `cw_update_ticket`, `cw_create_company`, `cw_update_company`, `cw_create_contact`, `cw_create_project`, `cw_add_project_ticket_note`, `cw_create_time_entry`, `cw_update_time_entry`, `cw_delete_time_entry`, `cw_create_activity`, `cw_create_catalog_item`, `cw_update_catalog_item`, `cw_create_agreement_addition`, `cw_update_agreement_addition`.

The ticket card's Add note action and emitted note defaults were removed; the bundled HTML was rebuilt. Read queries, schemas and successful CW payloads are preserved. The existing 404/405 allNotes fallback is preserved. Security exceptions: HTTPS URLs without userinfo/query/fragment are required; redirects are refused to prevent sending credentials to an unexpected destination; remote transports reject relaxed TLS. Configure the final CW API URL rather than a redirecting URL. Explicit relaxed certificate validation remains available through local environment configuration only; production needs a valid certificate/trust chain.

## Configuration and diagnostics

`src/config.ts` owns validation and environment mapping. `ConfigProvider` resolves a service-owned configuration snapshot synchronously or asynchronously; `createHttpHandler` and `createWorker` accept this provider. A later Key Vault adapter can implement this interface, or managed secret references can populate the existing environment variables. No Azure SDK or network call was added. Explicit null configuration never falls back to another transport's process environment.

Remote per-request `X-CW-*` credentials and gateway mode are rejected. Users cannot select a different CW server or credential set through MCP HTTP headers. Secrets remain in process memory; local environment variables remain supported. Do not commit a real `.env` file.

`src/diagnostics.ts` accepts fixed event names and emits only safe messages. Raw error messages, stacks, causes, objects, headers, identities and URLs are not serialized. CW non-success response bodies are not returned to MCP clients or logged; only validated HTTP status codes survive. Fetch/JSON errors become a fixed redacted error. JWT diagnostic decoding and role/identity logging were removed; dormant OAuth proxy failures are sanitized. This intentionally reduces troubleshooting detail. These guarantees cover application diagnostics, not arbitrary future code, heap dumps, infrastructure access logs, or instrumentation installed outside this repository. No new telemetry was introduced.

## HTTP authentication boundary

The precise Node extension point is `createHttpHandler({ authenticate, configProvider, allowedOrigins })` in `src/http-server.ts`. Its `McpAuthenticator` receives the HTTP request and returns true only after token validation and caller authorization. The gate runs before configuration/secret resolution, MCP server creation, or SDK request handling. False denies access; thrown errors fail closed with a generic response. Header validation rejects per-request CW credentials. Browser Origins are denied unless explicitly allowlisted. Health is a shallow unauthenticated liveness endpoint.

`requireHttpAuthentication` rejects the shipped HTTP CLI's startup before binding a socket because no production authenticator has been integrated. An adapter must be explicitly supplied in a later composition change. Setting legacy `MCP_OAUTH_ENABLED`, `MCP_BEARER_TOKEN`, or `CONDUIT_S2S_SECRET` does **not** unlock HTTP. The inherited simulated registration/authorization/token proxy routes and static bearer fallback are no longer mounted. Existing Entra verifier modules remain dormant and tested; they are not a complete ChatGPT OAuth integration.

For deliberate local HTTP testing only:

```sh
MCP_TRANSPORT=http MCP_HTTP_HOST=127.0.0.1 MCP_ALLOW_UNAUTHENTICATED_LOCAL=true NODE_ENV=development npm start
```

The exception requires exact loopback binding (`127.0.0.1` or `::1`) and a non-production environment. Do not tunnel or reverse-proxy this development exception onto the Internet. Default stdio remains usable with service credentials.

The Worker default similarly returns 503 for `/mcp` until its `createWorker` authentication callback is supplied. No wildcard CORS or unauthenticated Worker bypass remains. It is not the proposed Azure deployment target.

This boundary deliberately stops short of pretending the service is ChatGPT-ready. Before deployment choose the Entra/MCP OAuth integration: protected-resource and authorization-server discovery, authorization-code/PKCE flow, registered ChatGPT callback, resource/audience handling, issuer/tenant checks, approved staff authorization, and refresh/rotation policy. A boolean callback alone is not an OAuth implementation. See [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) and [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth).

## Dependencies

| Package | Reviewed lock | Hardened lock |
| --- | --- | --- |
| MCP SDK | 1.30.0 | 1.32.0 |
| Undici | 8.10.0 | 8.11.2 |
| @hono/node-server | 1.19.9 | 2.1.3 |
| Hono | 4.11.9 | 4.13.13 |
| express-rate-limit | 8.2.1 | 8.7.0 |
| ip-address | 10.0.1 | 10.7.3 |
| path-to-regexp | 8.3.0 | 8.4.2 |
| fast-uri | 3.1.7 | 3.1.8 |
| qs | 6.15.0 | 6.16.0 |
| body-parser | 2.2.2 | 2.3.0 |

SDK/Undici were upgraded together; all original 77 tests passed against the upgraded dependencies in an isolated copy before hardening behavior changed. SDK's dependency range permits its updated Hono adapter. `fast-uri` has an explicit compatible 3.x override; no forced 4.x major upgrade. Zod 4.3.6 is now directly declared because source imports it. JOSE remains 6.2.10. Minimum Node is now 22.19.0 to match Undici; Docker/CI use Node 26.

`npm audit --omit=dev` reports **0 vulnerabilities**, resolving all nine affected production package entries in the review. Full audit reports **3 high affected development package entries**, representing one remaining advisory chain: `vite-plugin-singlefile → micromatch → braces`, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). No compatible fix is offered; npm proposes a breaking downgrade of the UI build plugin to 0.9.0. This is build-time glob pattern stack exhaustion, not a production dependency; do not feed untrusted glob patterns into the build. Replacing the bundler plugin is deferred for a separate reviewed change. No production finding needs a breaking architectural remediation. Audits are time-specific advisory checks, not proof of absence of vulnerabilities.

Removed semantic-release and its changelog/git/GitHub plugins along with the unused release configuration. Package publication is disabled with `private: true`, and the inherited GitHub package-registry destination was removed.

## CI and inherited trust

All four inherited workflows were reviewed and removed:

- `add-to-project.yml`: WYRE reusable workflow/project access and inherited secrets.
- `mcp-assert.yml`: WYRE reusable evaluation workflow.
- `release.yml`: WYRE reusable publishing workflow and registry destinations.
- `claude.yml`: external AI workflow requiring an Anthropic OAuth secret.

New `ci.yml` performs install with scripts disabled, UI build, TypeScript build, lint, tests, and production audit. GitHub checkout/setup-node actions are pinned to commit SHAs, token permissions are read-only, checkout credential persistence is disabled, and no fork secrets/publishing/deployments are used. GitHub runner and npm downloads/advisory checks remain ordinary build dependencies; no runtime hosted service was added. Dependabot remains with weekly grouped updates; no automatic merge workflow exists. CODEOWNERS now names the fork owner. Upstream license/author attribution is retained.

The DigitalOcean deployment template and inherited MCP registry descriptor advertising the WYRE image were removed. Both Compose templates now build/tag a local image; neither uses the WYRE registry. Existing Compose production startup intentionally fails until authentication is integrated. Docker includes LICENSE, rebuilds the read-only card, prunes development dependencies without lifecycle scripts, and retains its non-root user. No container image has been built or scanned in this step.

## Validation and remaining deployment blockers

Existing seven test files are retained. Tests that expected writes now assert absence/rejection; pure payload/patch regressions remain. The test-only Worker fixture injects explicit authentication and service configuration, without weakening the production Worker. Vitest now includes only source tests rather than double-running emitted `dist` tests after a build. Added hardening tests cover all 39 reads, all 16 removed writes, direct client write rejection, safe logs/errors, HTTPS validation, default HTTP refusal, local exception restrictions, Origin/header rejection, and gate ordering for Node/Worker.

Final validation on 2026-10-04 (local Node 25.6.1):

| Command | Result |
| --- | --- |
| `npm run build:ui` | Passed; ticket card rebuilt/embedded |
| `npm run build` | Passed, exit 0 |
| `npm run lint` | Passed, exit 0; zero ESLint findings |
| `npm test` | Passed, exit 0; 8 files, 118 tests, zero failures |
| `git diff --check` | Passed, exit 0 |
| `npm audit --omit=dev` | Passed, exit 0; zero vulnerabilities |
| `npm audit` | Exit 1; 3 high development package entries in the single documented braces advisory chain |

The CLI startup integration test uses built output, so run the build before the full suite, as CI does. All CW responses are mocked. No live ConnectWise API or Azure endpoint was contacted. Docker/Node 26 container execution and GitHub-hosted CI have not been exercised locally.

Before Azure deployment:

1. Complete and test the chosen standards-compliant MCP/OAuth adapter with ChatGPT and Entra. Test anonymous, invalid/expired/wrong-tenant/wrong-audience/unassigned tokens. Decide whether all approved staff share the same CW read scope.
2. Provision a dedicated read-only CW API member and verify its actual server-side permissions. Runtime GET-only protection is not a substitute for least privilege.
3. Configure an independent Azure service, HTTPS/custom domain `api.monotorr.com`, `/mcp` routing, identity, service-owned secrets via Key Vault, rotation, and outbound access to the final public CW API URL. No Azure resources or secret integration were added here.
4. Set approved Origins, request limits/timeouts/rate limits, and infrastructure log redaction/retention for the deployment; verify no proxy records Authorization headers or CW data.
5. Build/scan the actual container and validate TLS, network routing, health behavior and end-to-end read calls in a controlled environment. Audit build dependencies again; resolve the remaining development advisory in a separate bundler change when feasible.

The hardened checkout is ready for code review. It is deliberately **not deployable as a working public MCP endpoint yet**: authentication is an explicit blocker rather than an insecure default.
