# Phase 1 Slice 2 — one customer ConnectWise connection

Status: live Slice 2 acceptance PASS on 2026-10-10. Source `e6dc9ae4a7cd277c52556e2ae913edcad23921d5` is deployed; final acceptance evidence is recorded below. Earlier repository checkpoints remain as chronological history. Starting checkpoint: `a0b6e6ff33f6347a17447065d12e89636b6ad8d2`, `phase1-hardening`.

Scope authority: [V1 architecture](V1_PRODUCT_ARCHITECTURE.md), [implementation plan](V1_IMPLEMENTATION_PLAN.md), [delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md). The existing MCP remains on its pilot credentials and exactly 39 read tools / zero write tools. Account-aware MCP, Descope linking, credential reading by MCP, replacement/editing, billing and admin functionality are outside this slice.

## Account and connection model

`POST /connectwise/v1/connectwise/connection` accepts exactly `url`, `companyId`, `publicKey`, `privateKey`. It requires the existing server-side browser session, exact portal Origin/CSRF policy, and an enabled feature. Query selectors, account headers and extra JSON properties cannot select another account. Authentication precedes the bounded, uncompressed 8 KiB JSON parser.

The server derives user/account from the session. Ownership and the current active trial are checked in PostgreSQL before the validation callback or any credential-vault operation. Entitlement is checked again after validation and during activation. Only trials exist in the current Slice 1 implementation; this slice does not implement the later billing/entitlement sources. No identity has an admin bypass.

Migration `0003_connectwise_connections` adds only connection metadata: UUID ID/account FK, canonical URL, Company ID, opaque versioned public/private secret references, status and timestamps. `UNIQUE(account_id)` is stricter than one active connection: there can be only one current record of any state. No API keys or per-customer Client ID column exists. A connected row requires both references, constrained to the dedicated vault and that row's immutable connection ID. Runtime may SELECT/INSERT/DELETE and update only state/reference/timestamp columns; no schema/admin grants.

An account advisory transaction lock serializes submissions. Connected duplicates return a fixed 409; concurrent or recent pending attempts return `setup_in_progress`. Status queries validate current ownership and only return the caller's safe connection host/company. A separate account stays Not configured without revealing another account's metadata.

## Validation and SSRF boundary

`src/connections/validation.ts` reuses `CwManageClient`. The only request is `GET /system/info`, resolving to the standard `/v4_6_release/apis/3.0/system/info`. Basic authentication remains `CompanyID+PublicKey:PrivateKey`; server-side registered Monotorr Client ID is `241218b8-34d4-4eb0-9d48-244ec0fc7669`. Neither customer inputs nor environment overrides supply this identifier here.

The existing client source is restored byte-for-byte to starting checkpoint `a0b6e6ff33f6347a17447065d12e89636b6ad8d2`. A short-lived control-only Node worker composes that unchanged client with the pinned transport; its fetch substitution affects only that worker's JavaScript realm, never the control main thread, another validation worker or MCP. No private client fields, copied authentication logic or client fork is used. The validation transport uses the already installed undici fetch/Agent pair, verified TLS, no redirects/retries, a 10-second total deadline, and disposal of the actual response body. HTTP 200 JSON is the success gate; response contents are never parsed. Only an empty synthetic JSON object is passed to the client's existing JSON consumption step. HTTP 401/403, TLS, unreachable/unsafe host and other rejection categories are fixed sanitized errors, never raw exceptions or response bodies.

URLs must be HTTPS, without userinfo, query, fragment, custom port or arbitrary path. Root and the standard API base path normalize consistently. Cloud and publicly reachable on-prem instances use exactly the same setup flow. Standard HTTPS port 443 is supported. Arbitrary path prefixes, nonstandard ports, private networks, tunnels and TLS bypass are not supported.

`src/security/outbound-target.ts` rejects local hostnames, loopback/private/link-local/CGNAT/multicast/reserved/documentation/benchmark IPv4 and Azure platform IPs. IPv6 requires public global-unicast and excludes special-use, documentation and transition ranges; mapped/NAT64/private/loopback destinations fail closed. Every DNS result must be public. The TCP lookup is pinned to the first validated IP with no second DNS lookup; TLS retains the supplied hostname. Any redirect fails rather than following to another destination. No response bodies, keys or internal addresses are logged.

## Credential persistence and failure handling

Approved dedicated vault: `monotorr-cw-creds-kv`, product RG `monotorr-connectwise-prod-rg`. It contains customer-supplied ConnectWise keys only. Existing `cw-mcp-kv` and its permissions remain unchanged.

Secret names: `cw-connection-<immutable UUID>-public` and `cw-connection-<immutable UUID>-private`. Names contain no email, company, URL or key fragment. Stored references include the returned secret version; unexpected vault/name/version references are rejected.

Sequence:

1. Hold credentials only in request memory; check ownership/entitlement and account lock.
2. Execute the bounded safe GET and recheck entitlement.
3. Commit a nonactive `persisting` row containing a durable cleanup locator and metadata only.
4. Write both keys to Key Vault and validate returned version references.
5. Conditionally activate the row with both references and a fresh eligibility check.
6. Return only Connected; subsequent status requests show safe metadata.

The pending row precedes Vault writes so a process crash cannot leave an unlocatable partial pair. This is cleanup intent, not active connection metadata or unverified credentials. No row becomes Connected before successful validation and both confirmed references.

On partial persistence or activation failure, atomically mark a nonactive row `cleanup_required`, delete both secret names (including absent-name 404), and remove the pending locator only after acknowledged cleanup. If activation acknowledgement is lost, inspect the scoped database row first: a connected row with the exact written references is preserved and treated as success. Never delete an uncertain possibly active pair.

If cleanup/database acknowledgement fails, retain the locator and emit only `connection.cleanup_required` plus opaque internal connection ID. A subsequent entitled setup reclaims `cleanup_required` or a pending row older than five minutes before creating a fresh UUID. Recent pending attempts fail closed. No scheduled administration service or broad credential reader is introduced. Persistent cleanup failures require operator investigation; they do not appear Connected.

The official Secrets SDK handles writes. Its delete poller performs a deleted-secret value GET; therefore cleanup uses the documented Key Vault DELETE REST operation with the official managed-identity credential, fixed vault URI and allowlisted names. It never polls a deleted value or performs get/recover/purge. Tokens stay in memory, redirects are blocked, responses are disposed, and failures are sanitized. See [Microsoft DELETE documentation](https://learn.microsoft.com/en-us/rest/api/keyvault/secrets/delete-secret/delete-secret?view=rest-keyvault-secrets-2025-07-01).

The control API's system-assigned identity is the writer. No local/env credential fallback is used for customer persistence. Azure SDK secret/identity diagnostic sinks are disabled for this writer. No new dependency was added. Neither GitHub, migration, bootstrap nor the existing MCP runtime gets customer-vault access.

## Portal and deployment gate

The existing portal adds a gated Connect ConnectWise button and four fields; both keys are password inputs. Keys are cleared on submission, are never saved in browser storage, and never redisplayed. Success refreshes account status; failures display allowlisted categories. Connected accounts have no replacement form.

`CW_CONNECTION_SETUP_ENABLED=true` is the explicit activation flag; absent/false disables POST and setup UI. Enabling also requires `CW_CUSTOMER_FEATURES_ENABLED=true`. The feature is enabled on the deployed Slice 2 control revision. Even disabled deployments of this source require migration 0003 before readiness/status checks.

Use the existing reviewed immutable GitHub OIDC build → migration/candidate → smoke → promotion → portal path, not a new deployment mechanism. The executable MCP-impact guard remains unchanged and now proves this control-only transport isolation leaves all 26 MCP runtime outputs identical. Committed clean source and the existing delivery/smoke/owner-dogfood requirements still apply. Existing MCP must not be redeployed as part of Slice 2.

## Approved live resources — created 2026-10-10

Pre-change read-only Azure verification found:

- Control API system-assigned principal: `eeed932b-44aa-4c2d-9f2a-6796b942961a`.
- Existing East US subnet: `snet-monotorr-private-endpoints`, VNet `monotorr-prod-vnet`, RG `monotorr-dev-eastus-rg`; private endpoint network policies Disabled.
- Existing `cw-mcp-kv` has no private endpoint and resolves through `data-prod-eus.vaultcore.azure.net`, not the proposed private-link zone. Its networking/permissions are unchanged.
- No existing `privatelink.vaultcore.azure.net` zone was returned in the current subscription. Create only that dedicated zone and one link to the existing VNet; do not alter PostgreSQL DNS or public DNS.

Approved resources now created, all product RG / East US where regional:

- Standard RBAC Key Vault `monotorr-cw-creds-kv`, public access Disabled, network ACL Deny, bypass None.
- Soft-delete retention 90 days and purge protection enabled. Purge protection cannot later be disabled; deletion is recoverable, not an immediate cost/resource erasure mechanism.
- Private endpoint `pe-monotorr-cw-creds-kv`, using the existing subnet; Key Vault `vault` group.
- Private DNS zone `privatelink.vaultcore.azure.net`, VNet link `connectwise-customer-vault`, private endpoint zone group `default` (only new vault DNS record).
- Custom role from `deployment/azure/customer-credential-writer-role.json`, assignable at product RG, but **assigned only at this vault** to the control API system-assigned principal.

The custom role has no management Actions and exactly these DataActions:

```json
[
  "Microsoft.KeyVault/vaults/secrets/setSecret/action",
  "Microsoft.KeyVault/vaults/secrets/readMetadata/action",
  "Microsoft.KeyVault/vaults/secrets/delete"
]
```

No getSecret, purge, recovery, backup, restore, vault administration or RBAC permission. Resource/role creation is a separately approved operator management-plane action; no customer-vault permissions are added to GitHub. Existing application identity permissions remain intact; only the new-vault writer assignment is additive.

### Approved creation commands — executed

These commands were executed after explicit owner approval and subscription/name/provider validation. They contain no customer keys and create no secrets.

```sh
az account set --subscription 08a97e42-1e1f-4f33-95dc-36af13337091
az keyvault create --name monotorr-cw-creds-kv \
  --resource-group monotorr-connectwise-prod-rg --location eastus --sku standard \
  --enable-rbac-authorization true --public-network-access Disabled \
  --default-action Deny --bypass None \
  --retention-days 90 --enable-purge-protection true --output none

az network private-endpoint create --name pe-monotorr-cw-creds-kv \
  --resource-group monotorr-connectwise-prod-rg --location eastus \
  --subnet /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-dev-eastus-rg/providers/Microsoft.Network/virtualNetworks/monotorr-prod-vnet/subnets/snet-monotorr-private-endpoints \
  --private-connection-resource-id /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.KeyVault/vaults/monotorr-cw-creds-kv \
  --group-id vault --connection-name connectwise-customer-vault --output none

az network private-dns zone create --resource-group monotorr-connectwise-prod-rg \
  --name privatelink.vaultcore.azure.net --output none
az network private-dns link vnet create --resource-group monotorr-connectwise-prod-rg \
  --zone-name privatelink.vaultcore.azure.net --name connectwise-customer-vault \
  --virtual-network /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-dev-eastus-rg/providers/Microsoft.Network/virtualNetworks/monotorr-prod-vnet \
  --registration-enabled false --output none
az network private-endpoint dns-zone-group create \
  --resource-group monotorr-connectwise-prod-rg --endpoint-name pe-monotorr-cw-creds-kv \
  --name default --zone-name customer-vault \
  --private-dns-zone /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.Network/privateDnsZones/privatelink.vaultcore.azure.net \
  --output none

az role definition create --role-definition deployment/azure/customer-credential-writer-role.json --output none
az role assignment create --assignee-object-id eeed932b-44aa-4c2d-9f2a-6796b942961a \
  --assignee-principal-type ServicePrincipal --role 'ConnectWise customer credential writer' \
  --scope /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.KeyVault/vaults/monotorr-cw-creds-kv \
  --output none
```

Verify the private endpoint is Approved, private DNS resolves the vault URI to the new private IP from the control API network, public access remains Disabled, and the custom assignment is exactly scoped. Validate required SDK write/delete operations using synthetic values only in a separately approved deployed test; never test with a secret-value GET. Stop on unsupported role actions, DNS collision, unexpected permission requirements or unsafe output.

Verified incremental fixed estimate: approximately **$7.80/month** for the private endpoint ($7.30 at 730 hours) and private DNS zone ($0.50), plus usage-based Vault operations, DNS queries and Private Link traffic. No diagnostic-log ingestion was added. Public firewall exceptions, public DNS serving portal/API/MCP, existing vault assignments and existing MCP settings were not changed.

### Rollback / cleanup

Keep setup disabled until storage/private connectivity/migration/candidate validation succeed. Roll back only the separate control API/portal through the existing documented process; retain additive migration 0003 and its data. Disable setup and remove only this new writer assignment if access must be revoked. Never revoke existing `cw-mcp-kv` assignments.

Before any customer data exists, separately authorized cleanup may remove only the new private endpoint, its zone group/link/zone (if dedicated) and new role assignment/unused definition, then soft-delete the new vault. After customer setup, retain vault/data until an explicit retention/recovery decision; no purge. Do not delete shared VNet/subnet or any existing DNS zones. Never roll back by deleting possibly active credentials.

## Validation and live acceptance

Repository tests cover strict inputs, DNS pinning/special ranges, GET-only validation with global Client ID, bounded TLS/redirect/body behavior, write/delete-only Vault operations and sanitized errors, role contract, HTTP isolation/CSRF/gating, portal field/output behavior and real PostgreSQL 18 concurrent/duplicate/foreign-account/expired-trial/partial-write constraints. Existing MCP/auth/config tests remain part of the full suite.

Live Slice 2 acceptance is **PASS**; deployment and bounded read-only evidence are recorded below. The first customer completed the real portal setup and repeat login; the second remains unconfigured and isolated. No first-customer keys were copied into the second account. Existing MCP still uses its separate pilot configuration; this acceptance does not claim account-aware MCP credential resolution.

Cloud and on-prem representative read compatibility remains a pre-launch gate. New-vault managed-identity write/delete behavior, private networking and deployed browser setup passed live verification. Publisher verification remains the Slice 1 pre-launch item, without added Graph permissions.

Future handoff: a later approved account-aware MCP slice may resolve the entitled account's connected metadata/version references with a separate scoped reader identity. This slice grants none of that access and does not modify MCP credential resolution.

### Repository validation checkpoint — 2026-10-10

- Focused connection HTTP/security tests: passed (63 tests after the final deadline regression).
- Full suite with `CW_DATABASE_INTEGRATION=true` against disposable `postgres:18-alpine`: **26 files / 558 tests passed**, including migration/bootstrap tests and account-scoped connection fixture. Container removed after validation.
- `npm run build:ui`, `npm run build`, `npm run build:portal`, `npm run lint`: passed.
- `npm run validate:ticket-card`: self-contained output, embedded match and script syntax all true.
- `npm audit --omit=dev` and `npm audit`: **0 vulnerabilities** each.
- `git diff --check`: passed. No package/dependency changes or credential/environment files included.
- No commit, push, vault creation, role assignment, deployment, customer-key retrieval or Phase 3 work performed.

Repository ready for review. **Slice 2 live acceptance remains pending**, not PASS. Separate owner approval is required for the resource plan, and the existing delivery guard must be resolved through reviewed control-only delivery planning before promotion. No existing production MCP change is proposed.

## Prior promotion-guard review — superseded transport-injection checkpoint

The owner approved the exact vault, private networking, 90-day retention/purge protection, three-action custom role and control-API-only vault assignment above. No resource or RBAC action has been executed.

The previous `needsDogfood` path heuristic flagged every `src/connections/*` change, regardless of MCP reachability, as well as the shared `src/api-client.ts` change. Control API connection code is not imported by the MCP entrypoint. However, the optional fetch/signal injection in the shared client **does change emitted MCP-reachable JavaScript**. Default behavior tests passing is not proof of byte-identical executable output.

`release.mjs` now requires `assessMcpImpact(previousSha, sha)` to return `unchanged` before control promotion. The checker compiles both committed snapshots using the locked TypeScript compiler/configuration, traverses the executable ESM closure from `dist/index.js`, and compares module bytes and membership. Static imports/reexports and literal dynamic imports are included; external packages are covered conservatively by unchanged package/lock/build inputs. Changes to dependency manifests, MCP Dockerfile/context rules, ticket-card sources/build inputs or compiler settings remain blocked. Source maps/declarations are not executable proof inputs. Control-only emitted files outside the MCP closure are excluded, not deployed or executed by the MCP entrypoint.

Unsupported computed imports, runtime code/source loading, compiler failures, missing inputs/history, unknown revisions or missing output fail closed. A shared type-only change can pass **only if the emitted MCP closure is identical**. Real shared-client, auth, runtime or tool output changes remain blocked with `mcp_affecting_release_requires_separate_review_and_owner_dogfood`. There is no bypass/override flag. Promotion also rejects dirty source. The existing broad helper remains conservative; the promotion decision uses executable evidence rather than that heuristic.

The existing manual/OIDC workflow installs locked dependencies in its delivery job so the compiler proof is available; it does not introduce a new trigger, identity, permission, artifact deployment path or MCP operation.

Local read-only inspection:

```sh
node scripts/deploy/mcp-impact.mjs HEAD --working-tree
```

Result for the prior transport-injection working tree: `impact: changed`, `changedOutputs: ["dist/api-client.js"]`, 26 reachable modules. This command is inspection only; promotion accepts only validated committed SHAs, never working-tree evidence. The new control output also differs as expected. No MCP image was built, published or deployed by this review, and the existing live digest/config/routing/revision/traffic/probes remain untouched.

**At that prior checkpoint, the false-positive classification was corrected, but Slice 2 promotion remained properly blocked on the real shared-client output difference.** Do not proceed with vault creation/migration/candidate deployment under this checkpoint. The existing separate MCP review/dogfood requirement must be satisfied through an explicitly reviewed delivery decision, or a separately reviewed control-only transport arrangement must make the MCP closure identical. This review does not invent an automatic override or claim equivalence for changed executable bytes.

Once that block is resolved and live execution is separately authorized, the exact resource commands above remain the approved proposal. Then use the existing immutable control image build, migration 0003 through `connectwise-migrate`, and control candidate deployment/smokes with setup gated; do not rebuild/deploy the MCP. Setup enablement requires a separately reviewed control configuration action after private-vault write/delete verification. Rollback restores only the prior control API/portal revision, retains the additive migration and customer-vault data, and removes only the new writer assignment if needed.

### Guard validation checkpoint

- Focused delivery tests: **70 passed** (impact comparison, promotion failure gates and delivery foundation).
- Full suite with real disposable PostgreSQL 18: **27 files / 581 tests passed**. Existing exact 39 reads / zero writes, customer authentication and connection tests remain green.
- Backend, portal, ticket-card build/validation, lint, production/full dependency audits and diff check passed; both audits report **0 vulnerabilities**.
- Independent check: all **26 reachable MCP modules** emitted by the snapshot compiler match the actual backend build byte-for-byte. Comparison to HEAD still reports only `dist/api-client.js` changed.
- No resource creation, RBAC assignment, migration execution against Azure, candidate deployment, MCP image build/publication or live configuration change performed. No commit/push.

### Exact subsequent migration/candidate actions — conditional, NOT EXECUTED

After immutable reviewed source/image evidence exists and live execution is separately authorized, invoke the existing manual GitHub workflow actions `build` then `prepare`; do not introduce direct operator deployment. `prepare` performs these existing control-only Azure actions (placeholders are nonsecret values derived from recorded immutable evidence):

```sh
# Pin current control production traffic before candidate/migration changes.
az containerapp ingress traffic set -n connectwise-control-api \
  -g monotorr-connectwise-prod-rg --revision-weight '<recorded-prior-control-revision>=100' -o none

az containerapp job update -n connectwise-migrate -g monotorr-connectwise-prod-rg \
  --image 'monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:<reviewed-digest>' -o none
az containerapp job start -n connectwise-migrate -g monotorr-connectwise-prod-rg \
  --query name -o tsv
az containerapp job execution show -n connectwise-migrate -g monotorr-connectwise-prod-rg \
  --job-execution-name '<returned-execution-name>' --query properties.status -o tsv

# Only after migration execution Succeeded. Existing customer-login settings are preserved.
az containerapp update -n connectwise-control-api -g monotorr-connectwise-prod-rg \
  --image 'monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:<reviewed-digest>' \
  --revision-suffix 'p0-<reviewed-source-sha-first-12>' \
  --set-env-vars CW_CUSTOMER_FEATURES_ENABLED=true \
  CW_PORTAL_LOGIN_CLIENT_ID=4405ef16-dc89-4385-8a84-cda2a52274cf -o none
az containerapp revision show -n connectwise-control-api -g monotorr-connectwise-prod-rg \
  --revision 'connectwise-control-api--p0-<reviewed-source-sha-first-12>' \
  --query '{health:properties.healthState,image:properties.template.containers[0].image}' -o json
az containerapp revision label add -n connectwise-control-api -g monotorr-connectwise-prod-rg \
  --revision 'connectwise-control-api--p0-<reviewed-source-sha-first-12>' \
  --label candidate --yes -o none
```

The job retains its existing migration command and separate database identity, applies/checks manifest through migration 0003, and gains no customer-vault access. Existing rollback evidence is saved before mutation. Candidate readiness/health and anonymous MCP regression smokes must pass before a separately approved promotion. No actual digest, job execution or candidate is claimed for this repository checkpoint. Feature enablement is not supplied by the current prepare command and remains separately reviewed/gated; no public setup exposure is introduced implicitly.

## Control-only transport isolation — current design

`src/api-client.ts` is exactly the committed starting version. `validation.ts` starts one short-lived control-only Node worker per authorized validation. `validation-worker.ts` imports the unchanged production client; `validation-transport.ts` retains DNS pinning, verified TLS, redirect blocking, response disposal, sanitized categories and the global registered Client ID. The worker executes the client's original `get('/system/info')`; header/auth/path construction remains production code. The transport independently rejects any different target/method or second request before sending it.

Fetch is replaced only inside that isolated worker realm. No process-global fetch or dispatcher is changed in the control API main thread; concurrent validations have separate workers. Parent-side termination bounds startup plus validation to ten seconds; DNS/request cancellation and Agent destruction remain in the worker transport. Workers are created only after the existing ownership/entitlement/account-lock checks. Database pool/serialization limits remain unchanged; no worker pool, extra service or dependency is added.

Credentials cross the worker boundary only through in-memory workerData, never argv, environment overrides, files or artifacts. Both worker output streams are consumed without forwarding. The parent ignores raw worker exceptions and validates an exact allowlisted result shape: success only, or a fixed failure category. It never accepts raw headers, bodies or claims. Workers terminate after success/failure/deadline. The existing form and Vault persistence model remain unchanged.

Tests cover production-client auth/global Client ID reuse, GET-only/single-target enforcement, DNS/TLS/redirect/body guarantees, isolated real compiled workers rejecting private targets, concurrent workers leaving main-thread fetch untouched, unexpected worker messages/exceptions/output suppression and timeout termination. Actual successful customer ConnectWise validation in the deployed control worker remains a live Slice 2 acceptance gate; no live connection is claimed from these local tests.

The MCP guard has not been relaxed or bypassed. Comparison against the exact starting checkpoint requires unchanged MCP closure and all protected dependency/compiler/container/UI build inputs. The earlier shared-client transport block is historical and is resolved by isolation rather than by overriding evidence. Current MCP source/artifact/configuration/tool behavior remains unchanged; no MCP image or Azure setting is rebuilt/deployed here.

### Isolation validation checkpoint — 2026-10-10

- Comparison against `a0b6e6ff33f6347a17447065d12e89636b6ad8d2`: `impact: unchanged`, empty changedOutputs, **26 reachable modules**. All protected dependency/compiler/container/UI build inputs are identical.
- Independent verification: `src/api-client.ts` equals the committed starting source byte-for-byte; all 26 comparator modules equal the actual backend build byte-for-byte.
- Focused Slice 2 tests: **78 passed**; focused delivery/MCP-impact tests: **70 passed**.
- Full suite with real disposable PostgreSQL 18: **29 files / 596 tests passed**, including exact **39 read tools / zero writes** regressions. Disposable database removed after validation.
- Backend, portal, ticket-card build/validation, lint and diff checks passed. Both production/full audits: **0 vulnerabilities**. No new dependencies.
- The earlier transport-injection artifact blocker is resolved without weakening the guard or changing MCP runtime code. Clean committed source, reviewed immutable build and separately authorized live actions remain required.
- No commit, push, Azure resource/RBAC change, MCP build/publication/deployment, Slice 2 deployment or account-aware MCP/Slice 3 work performed. Live worker success/customer setup remains pending deployed acceptance.

## Approved live execution — pending checkpoints

The owner authorized the presented Slice 2 resource/RBAC/source/migration/candidate/portal/acceptance sequence. `prepare` now sets `CW_CONNECTION_SETUP_ENABLED=true` only in the new control API candidate update after successful migration; promotion and rollback do not change environment settings. No existing MCP action is added.

Before the first live Azure mutation, obtain and record a fresh ordinary-owner production ChatGPT result: `cw_test_connection → connected:true`. This manual result is not inferred from an SDK test or earlier release. After deployment/acceptance repeat the same ChatGPT check and require connected:true, in addition to automated exact 39-read/zero-write regression. Stop at the explicit Codex promotion gate after private-vault/candidate smoke evidence; do not auto-promote.

### Approved candidate-setting validation

Candidate-only setting regression tests passed: the setup flag appears only on the new control API update after migration, never on promotion/rollback/MCP actions. Final checkpoint: **73 focused delivery tests; 29 files / 599 full-suite tests passed**, with PostgreSQL 18 integration. Builds, lint, ticket-card output, both audits (zero vulnerabilities), diff check and unchanged 26-module MCP comparison passed. Pre-change live metadata/DNS/inherited-RBAC checks passed; vault name is available, no existing private vault DNS zone was found, and the approved control system principal is unchanged. Fresh manual owner dogfood confirmation remains a hard gate before the first Azure mutation.

Installed Azure CLI preflight confirmed the vault network flag is `--default-action Deny` (the previously written longer spelling is not supported). This command spelling correction preserves the approved Deny policy and changes no resource design.


## Live Slice 2 acceptance — PASS (2026-10-10)

The owner confirmed the fresh ordinary-customer production ChatGPT pre-change connection test succeeded before resource creation. After deployment and customer setup, the owner explicitly confirmed `cw_test_connection` returned `connected:true` in production ChatGPT. This manual evidence is separate from SDK discovery checks.

### Deployed source and delivery

- Reviewed source: `e6dc9ae4a7cd277c52556e2ae913edcad23921d5`.
- Successful manual OIDC build: `38086442316`; prepare: `38086844634`; separately approved promotion: `38087296309`; portal: `38087475489`. Verification and delivery jobs succeeded on all four successful runs.
- Migration execution `connectwise-migrate-inl8e0t` succeeded, applying/checking the immutable manifest through `0003_connectwise_connections`. Job arguments and migration identity were not changed.
- Healthy production control revision: `connectwise-control-api--p0-e6dc9ae4a7cd`, **100% traffic**. Prior healthy `connectwise-control-api--p0-6f01e1d29881`: **0%**.
- Immutable image: `monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:6514b5a90f59b54a849c304c7343e9a7ae99edde6ff9e1f00f8c630aafb00fcc`.
- `CW_CONNECTION_SETUP_ENABLED=true` was set only on the new control candidate after migration. Candidate and promoted health/readiness smokes passed. Permanent portal `https://portal.monotorr.com` and canonical anonymous denial/CORS/Microsoft-login-start smokes passed.

The existing manual/OIDC path and scoped permissions were preserved. No new GitHub reviewer gate was introduced. An initial prepare run (`38086628067`) correctly rejected an old build artifact before migration/candidate creation: the protected environment's build pointer overrode the repository-level pointer. Updating the **environment-level** `CW_BUILT_RUN_ID` to the successful reviewed build fixed the retry. `CW_PREPARED_RUN_ID` in `connectwise-production` now identifies `38086844634`. Use environment-level evidence pointers for subsequent delivery actions; source/digest checks remain mandatory.

### Customer-vault boundary

The new Standard East US vault has RBAC enabled, public access Disabled, ACL default Deny, bypass None, 90-day soft delete and purge protection. Private endpoint `pe-monotorr-cw-creds-kv` is Approved/Succeeded in the existing subnet. Its dedicated private DNS zone/link completed with registration disabled and only the new vault record added; resolution from the control API network matched the endpoint.

Custom role definition ID `470bcdbd-de75-4a5c-afbc-2fdd8463864d` has exactly the three approved DataActions and no management Actions. Its sole customer-vault assignment is to control system identity `eeed932b-44aa-4c2d-9f2a-6796b942961a`, at the new vault scope. Inherited roles were reviewed and contain no data-plane secret access. GitHub, migration, bootstrap and MCP identities received no customer-vault assignment. Existing `cw-mcp-kv` properties and vault/secret-scoped assignments match the pre-change baseline.

A bounded candidate-only smoke invoked the actual compiled writer with synthetic values in memory: write verified **true**, cleanup verified **true**. No value GET, recovery or purge occurred. The synthetic pair is soft-deleted under the approved retention policy. Subsequent real customer setup succeeded through the same writer. No customer-key values were retrieved for diagnostics.

### Customer and database evidence

The owner reported first-customer Connected, correct safe host/company metadata, persistence across logout/re-login, and absence of the setup form afterward. The second customer's own portal remains Not configured with setup available and no first-customer connection metadata.

Bounded `BEGIN READ ONLY` diagnostics used the deployed runtime `databasePool(process.env)` with a five-second statement timeout. No migration-job arguments, DB privileges, schema or customer records were modified.

| Evidence | Result |
| --- | --- |
| Users / accounts / memberships / Microsoft identities / trials | 2 / 2 / 2 / 2 / 2; no duplicates |
| Connected connection rows | Exactly 1; no pending or cleanup-required row |
| First account | `1509be5b-f14d-49cb-b530-e29aaff95f40` |
| Connected row | `494a76b7-197e-42e2-900d-66a69e3172d3` |
| Stored public/private version-reference presence | Both true; values not printed |
| Second account | `ecce764e-4740-4398-ab00-d96ba494faf1`; no connection row |
| Original trial IDs / expirations | Unchanged from Slice 1; both 30-day durations valid |
| Deployed ConnectionStore own-status checks | First connected; second not_configured |
| Deployed ConnectionStore cross-account checks | Both denied with entitlement_required |

First trial remains `23cc74de-2272-4535-adf0-bba665287220`, expiring `2026-11-09T16:27:57.011Z`; second remains `7c2467d8-077b-4d30-a095-4353a59fd102`, expiring `2026-11-09T16:46:03.510Z`. No emails, keys, secret-reference values, session hashes, cookies or tokens were printed by the evidence queries.

The cross-account evidence invokes the actual compiled production status implementation inside a read-only transaction; it does not claim a live authenticated HTTP cookie-replay or foreign-account injection test. Those HTTP and entitlement-before-validation/storage failure cases are covered by the regression suite. Portal key clearing/no redisplay is covered by code/tests and the reported connected status screen; no browser storage or request bodies were exported. Only one customer's on-prem instance was configured; second-instance/Cloud compatibility remains a pre-launch gate.

### MCP preservation and validation

The comparator against actual previous release source `6f01e1d29881212e736472b7610dd1c6d64cd8ab` returned `impact: unchanged`, no changed outputs, **26 reachable modules**, with protected dependency/build inputs unchanged. Authenticated live SDK discovery passed before and after control promotion, negotiated `2025-11-25`, and matched exactly **39 read-only tools / 0 writes**. Owner pre/post production ChatGPT dogfood passed.

Final read-only Azure comparison confirmed unchanged MCP image, ingress/routing, revision `connectwise-mcp-pilot--0000005`, Single mode, traffic and probes. MCP digest remains `sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`. No Descope or pilot credentials changed; MCP has no customer-vault access.

Repository checkpoint validation: 73 focused delivery tests; **29 files / 599 full tests** with PostgreSQL 18 integration; backend/portal/UI builds, lint, ticket-card validation and diff check passed. Production and full audits reported **0 vulnerabilities**. Successful deployment runs repeated the normal verification gates. Final documentation-only closeout requires a diff check and owner review before any separate commit.

Azure exec transport required bounded, shortened quote-free commands. Terminal/quoting/oversized-command failures produced no acceptance evidence; subsequent bounded commands succeeded. A broad interactive shell was rejected by automatic approval review and was not used. No application or permission change was needed to collect evidence.

Rollback remains control/portal-only: retain migration 0003 and customer-vault data; restore the recorded previous revision through the existing workflow if needed. Do not delete active customer credentials, alter shared infrastructure or purge. No rollback exercise is claimed for this Slice 2 release. No account-aware MCP or Slice 3 work began.
