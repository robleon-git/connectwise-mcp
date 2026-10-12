# Phase 1 Slice 3 — Account-aware MCP execution

Status: source-checkpoint preparation; **not deployed or accepted live**. The source commit does not authorize live execution. Phase 4, billing, Substack, admin console and telemetry are excluded from this slice. Scope authority remains V1_PRODUCT_ARCHITECTURE.md and the approved Slice 3 task.

## Starting checkpoint and preflight

Branch `phase1-hardening`; clean starting checkpoint `bd257ddab28860c7b7b67dc737883ccb80b50905` (`Plan required V1 internal admin console`). Accepted Slice 2 closeout precedes it. The fresh local SDK preflight verified the real resource token, `/sub`, initialize, negotiated `2025-11-25`, and the exact 39-tool inventory. The owner separately confirmed production ChatGPT `cw_test_connection → connected:true`.

Read-only preflight observed portal/control API healthy, first ordinary customer Connected, second ordinary customer Not configured, and the private customer vault healthy. The existing MCP resolved the vault to `10.42.0.38` and completed a verified TLS handshake; no customer secrets were read by that network check.

Existing live MCP baseline: `connectwise-mcp-pilot--0000005`, image `monotorrdevacr6689.azurecr.io/connectwise-mcp@sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`, Single revision mode. This remains the live pilot; repository changes alone have not changed it.

## Verified identity linkage

**MONOTORR ACCOUNT IS DURABLE. DESCOPE IDENTITY IS REPLACEABLE.** Microsoft business login resolves the portal customer to a Monotorr internal user/account. MCP uses Descope native authentication; a verified Descope `(issuer, sub)` is explicitly linked to that already-authenticated Monotorr user/account. Portal and OTP emails need not match and never establish account ownership.

USER B (`rob@monotorr.com`, native Descope identity) is the intended Customer 1/owner MCP principal. USER C (`rleon@connections.com`, native Descope identity) is the intended Customer 2 MCP principal. USER A is the historical SAML/pilot principal, retained unchanged during the rollback window. Preserving USER A's subject or enrolling native authentication on USER A is not a Slice 3 completion prerequisite. Do not alter USER A, remove SAML or change existing ChatGPT DCR registrations during control-plane linking preparation.

Account, entitlement and ConnectWise connection data remain independent of the Descope binding. Identity replacement is a future supported recovery operation requiring explicit verified authorization; Slice 3 implements initial linking only, not replacement, recovery, automatic merging or binding reassignment.

The cryptographic boundary is the existing resource-specific Descope issuer, exact MCP audience, RS256, required `iss/aud/exp/sub`, expiry/not-before and `connectwise.read`. It returns only immutable `(issuer, subject)`, not JWT payloads, profile/email, or tokens. The old pilot allowlist remains only for legacy/offline fixtures; the new hosted entrypoint never invokes it.

A logged-in customer explicitly starts POST `/connectwise/v1/ai/link` from `https://portal.monotorr.com`. The API checks the existing active browser session and exact portal Origin. It creates an unpredictable state/verifier, stores only hashes plus current user/account/session ownership and a ten-minute expiration, and seals the verifier/state/session hash in a separate Secure/HttpOnly/SameSite=Lax cookie. The encrypted cookie has its own path and audience, separate from Microsoft browser login.

The browser navigates to the same resource-specific Descope authorization server using authorization code + PKCE S256, `resource=https://api.monotorr.com/mcp`, and `scope=connectwise.read`. There is no `offline_access` request or retained refresh token for linking. The fixed linking callback is `https://api.monotorr.com/connectwise/v1/ai/callback`.

The callback requires the same active browser session, matching encrypted state/session binding, and an unexpired one-use database attempt. It burns the attempt before token exchange. It exchanges the code server-side using the existing maintained openid-client dependency and verifies the **MCP access token** with the same resource verifier used by HTTP authentication. It discards the entire token response after obtaining the stable principal. A preview/session/ID token cannot substitute for the resource token.

The link is inserted for the existing internal user only. Unique `(issuer,subject)` and `(issuer,user_id)` constraints reject conflicting customer ownership and prevent implicit relinking. Repeating an already-owned verified link is idempotent. There is no email/domain matching, client-selected account, special owner identity, administrative override, or automatic new customer creation from an MCP token.

GET `/connectwise/v1/ai/status` exposes only `linked: true/false`. The portal shows minimal AI Setup and the canonical ChatGPT connection URL; it never displays subject IDs, credential references, or tokens.

### Linking configuration still requiring live approval/testing

`CW_MCP_LINKING_ENABLED` defaults off. Enabling it requires `CW_MCP_LINK_CLIENT_ID`, a predefined public code/PKCE client registered against the **existing resource-specific AS**, with the exact HTTPS callback above and token endpoint auth `none`. No client ID has been guessed or created. Startup verifies discovered issuer/JWKS, advertised S256, code response and public-client auth support. Descope client registration, callback compatibility and consistent subject across this client and ChatGPT must be verified live before cutover. The fixed client must exist **before** a linking-enabled control API candidate starts: provider initialization requires `CW_MCP_LINK_CLIENT_ID`. Register and verify the public client and its narrowly scoped User-access policy before deploying with `CW_MCP_LINKING_ENABLED=true`; do not use a placeholder client ID to make the callback reachable.

The independent native-only flow `monotorr-native-mcp-linking` is prepared and remains unassigned. Its `componentsVersion` editor/runtime delta from 3.22.0 to 3.22.3 is accepted; do not downgrade it. Live USER B/USER C OAuth tests after callback deployment must verify runtime consent/completion behavior. `connectwise.read` remains optional in Descope, while the MCP verifier requires the exact scope and denies missing scope before customer resolution, credential loading or ConnectWise execution. No resource scope update is required.

## Additive database change

Migration `0004_mcp_identity_linkage` adds only:

- `external_mcp_identities`: opaque issuer/subject → existing user, unique principal and one linked subject per user/issuer.
- `mcp_link_attempts`: hashed state/session binding, existing user/account membership, expiration; one outstanding attempt per browser session.

Existing Microsoft `external_identities` requires UUID tenant/object IDs and cannot safely represent opaque Descope subjects. The additive provider-specific identity table extends the same users/memberships/accounts; it introduces no second account hierarchy. No bearer tokens or ConnectWise operational data are stored.

The control DB role can SELECT/INSERT identity links and SELECT/INSERT/DELETE attempts, plus UPDATE only attempt state hash/expiration for replacing a pending flow. It cannot reassign identity mappings by UPDATE. Existing user/account/trial behavior is untouched.

A distinct `cw_mcp` login is created by the separately invoked bounded private bootstrap **before migration 0004**. It receives SELECT only on schema history, external MCP identities, membership, and the necessary columns of user/account status, entitlement and connection metadata. It cannot read browser sessions, linking attempts or profile email; cannot write, create schema/roles or assume the control/migration roles. Pools remain max three with verified DB TLS. Runtime password is the infrastructure secret `cw-mcp-db-password` in existing `cw-mcp-kv`, not the customer credential vault.

The original bootstrap is not rerun. The reviewed bootstrap packaging adds explicit `INITIALIZE_CONNECTWISE_MCP_READER`, refuses an existing role/non-placeholder password, initializes only that role/password, and never starts from application boot. The operator helper requires exactly the two temporary secret-scoped assignments, a manual single-replica/no-retry/180-second job and the exact purpose. Cleanup removes these assignments, disables the bootstrap password and deletes the job, including on failure. Cleanup failure is a stop condition.

Repository rendering only: `node scripts/deploy/render-resources.mjs <reviewed-control-image-by-digest> --mcp-reader` writes only the bootstrap manifest under ignored `.delivery/`. It makes no Azure call. The operator run/cleanup commands are `node scripts/deploy/bootstrap-database.mjs run-mcp` and `... cleanup-mcp`; **do not run until the separate live bootstrap/RBAC plan is approved**.

## Request authorization and credential ordering

Every hosted POST `/mcp` follows:

1. Verify OAuth resource token and produce the stable principal.
2. Resolve exactly one linked active internal user and active account/owner membership.
3. Evaluate the existing trial using the generic allow/deny evaluator and current DB time.
4. Resolve exactly one Connected connection for that account.
5. Validate both immutable credential references and customer URL.
6. Read only those public/private key versions from the fixed customer vault.
7. Supply the existing registered global Monotorr integration Client ID.
8. Construct a request-scoped client and execute the existing SDK/tool contract.

No valid identity/account/entitlement/connection means no customer-vault reads and no ConnectWise request. Unknown, ambiguous, disabled or admin-only identities fail closed. A linked and entitled unconfigured customer receives only `setup_required`; other account/entitlement failures return `access_denied`. Dependency failures return `service_unavailable`. Raw errors and other customer metadata are not exposed.

Authorization is reevaluated for every HTTP request, including initialize, notifications and tools/list. Entitlement/revocation/disconnect changes affect subsequent requests; this is not a mechanism to undo a GET already in flight after its authorization check. There is no cross-request customer credential or entitlement cache.

The hosted HTTP entrypoint requires `cw_mcp`/`cw-mcp-db-password` and migration checksums before binding. It has no global pilot configuration branch and never consults global CW URL/company/key environment values or pilot allowlist settings. Explicit local stdio and legacy factory tests retain local environment/Stage A behavior; they are not a hosted SaaS fallback.

## Customer credential reader — LIVE APPROVAL CHECKPOINT

No live permission has been changed by this repository work.

Proposed principal: existing MCP system-assigned identity `7dd93225-3108-44d0-a8c7-aaddb232ecc8`, distinct from control API, pull, GitHub, migration and bootstrap identities.

Proposed custom role: `ConnectWise customer credential reader`, defined in `deployment/azure/customer-credential-reader-role.json`.

Exactly one DataAction: `Microsoft.KeyVault/vaults/secrets/getSecret/action`. No management Actions, listing/metadata enumeration, write/delete/recovery/purge/backup/restore or RBAC management.

Assignment scope: `/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.KeyVault/vaults/monotorr-cw-creds-kv` only. Version-specific SDK GET is supported and used; neither latest fallback nor separate metadata/list calls are needed. Both references must match the fixed vault, immutable connection UUID, public/private kind and 32-hex version before either read.

This identity already represents the dedicated MCP application, so no additional customer reader service/identity is necessary. Its compromise can expose **all customer credential versions** accessible at this vault scope; application authorization is not per-secret Azure IAM. The shared DB reader likewise can read allowed metadata across accounts. Tenant isolation is enforced in the verified principal/account resolution and tested SQL/application boundary. No claim of per-account RBAC isolation is made.

The existing private ACA/VNet/DNS path was verified; the vault remains private-only. No new vault, public exception, endpoint or DNS modification is needed. GitHub, migration, bootstrap, control writer and pull identities receive no customer-secret read permission.

Proposed commands, **not executed**:

```sh
az role definition create --role-definition deployment/azure/customer-credential-reader-role.json --output none
az role assignment create --assignee-object-id 7dd93225-3108-44d0-a8c7-aaddb232ecc8 --assignee-principal-type ServicePrincipal --role 'ConnectWise customer credential reader' --scope /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.KeyVault/vaults/monotorr-cw-creds-kv --output none
```

Preflight must first check existing custom-role definition/assignment and inherited permissions; unexpected access stops execution. Rollback removes only the newly recorded assignment ID, without deleting the role if in use, secrets, mappings, or connection metadata.

A separate approval is also needed for the new infrastructure DB secret, secret-scoped MCP read access, temporary private bootstrap identity/admin access and cleanup. The existing MCP's legacy vault-wide Secrets User assignment must be reviewed explicitly during cutover; it is not silently changed here. Customer-vault writer permissions remain untouched.

## Request-scoped client and preserved MCP contract

`CwManageClient` accepts an optional instance transport; default behavior and Basic/header construction remain unchanged. The control validation worker still uses its established transport behavior. No authentication/header construction is duplicated.

The hosted customer transport uses standalone undici fetch with its matching Agent, verified TLS, an allowlisted HTTPS origin/API path, GET only, blocked redirects and DNS-pinned public addresses. DNS resolution/connection is lazy until an actual tool GET, so discovery does not depend on ConnectWise uptime. Private/reserved destinations and rebinding are rejected. The transport has a bounded 30-second execution budget and is aborted/destroyed when that HTTP response closes. No global environment/fetch/dispatcher is mutated.

Every HTTP request gets a fresh immutable configuration, client, SDK server and transport. Concurrent A/B requests cannot share customer state. The existing exact 39 tools, schemas, read-only annotations, GET guard, SDK protocol, protected resource metadata/challenges and ticket-card content are preserved. No account selector is added to tools. Customer/account headers are rejected, and ignored extra tool arguments cannot influence principal-derived resolution.

## Runtime configuration proposed for cutover

MCP: existing issuer/JWKS/resource/scope and HTTP settings; `CW_DB_HOST=monotorr-cw-db-01.postgres.database.azure.com`, `CW_DB_NAME=connectwise`, `CW_DB_USER=cw_mcp`, `CW_DB_PASSWORD_SECRET=cw-mcp-db-password`, `CW_KEY_VAULT_URI=https://cw-mcp-kv.vault.azure.net`. Customer vault and registered global Client ID are the same fixed product contract used by Slice 2. No customer key enters Container App environment variables.

Control API: preserve existing browser/configuration fields; add `CW_MCP_LINKING_ENABLED=true`, the approved nonsecret `CW_MCP_LINK_CLIENT_ID`, and resource issuer/JWKS/resource/scope only after their live configuration is reviewed. The callback uses existing `/connectwise/v1` routing. No hostname, MCP path or protected metadata route changes.

## MCP impact and delivery decision still required

The working-tree comparator against `bd257dd...` correctly reports `impact=changed`, 38 reachable modules and 17 changed/newly reachable outputs. These include api-client, resource auth, HTTP entrypoint/factory, account/vault/transport boundaries, existing connection validators and DB configuration/schema history. Dependency lock/build inputs are unchanged. This is an intentional MCP-affecting release, not a control-only unchanged-output release.

The existing manual/OIDC workflow remains unchanged and its conservative control promotion guard remains intact. It must **not** be bypassed for this source tree. Before commit/publication/live work, finish a reviewed extension of that same delivery process for immutable MCP artifact publication, migration/control/portal sequencing and explicit MCP acceptance/promotion. No bypass flag or unreviewed override has been added.

The existing MCP is Single mode. Candidate-before-promotion behavior cannot be assumed. An explicit release decision is required on a controlled Single-mode cutover versus a separately approved candidate strategy; no revision mode, traffic or extra candidate application has been changed. The exact workflow/RBAC/configuration and rollback actions must be presented before any live action. No production image is built or deployed by this document.

## Local validation and live acceptance status

Focused tests cover signed stable principal verification, resource/scope rejection, no email linkage, session-bound one-use linking, conflicts/replay/logout, exact-version GET, zero secret reads on denial, SSRF/GET/redirect/TLS controls, real SDK handshake/concurrent customer requests, schema equivalence and all 39 read tools. PostgreSQL 18 integration covers unique linking, one-time expiration, active membership/entitlement/connection resolution, A/B isolation, revocation/disconnect and database role denial. The one-shot bootstrap/cleanup path is separately tested.

Final source-checkpoint validation on October 11, 2026 used a repository-local snapshot with the three historical owner-continuity harness files absent:

| Gate | Result |
| --- | --- |
| Focused auth/linking/bootstrap/delivery tests | 175 passed across 6 files |
| Full regression with disposable PostgreSQL 18 integration enabled | 697 passed across 34 files; no skipped tests |
| PostgreSQL 18 migration/privilege integration | 2 passed within the full suite |
| Backend/control API, ticket UI and portal builds; TypeScript | PASS |
| Lint | PASS |
| Ticket card self-contained/embedded output/script syntax | PASS |
| Production dependency audit | 0 vulnerabilities |
| Full dependency audit | 0 vulnerabilities |
| git diff --check | PASS |

No package/lockfile, Dockerfile, tool-handler or generated ticket-card source change occurred. These are local evidence, not live Slice 3 acceptance.

Live linking, migration 0004, new DB role/secret/RBAC, customer credential reader assignment, account-aware MCP deployment and Customer 1/2 acceptance are **pending**. The verified pre-change pilot is still the running application. Do not report a Slice 3 source SHA, revision or digest as deployed.

After reviewed control-plane delivery: explicitly link native USER B from the ordinary Customer 1 portal session and native USER C from the separate Customer 2 portal session. Neither customer requires SAML/federation or email matching. Successful verified callbacks create the bindings automatically. The linking test does not reauthorize existing ChatGPT clients or deploy the account-aware MCP. After separately approved candidate/cutover work, verify Customer 1 connected:true and representative reads, Customer 2 unconfigured/zero-access behavior or its own separately configured instance, concurrent isolation and exact 39 reads/0 writes. Representative Cloud and publicly reachable on-premise validation remains mandatory before launch.

## Rollback boundary

Do not delete mappings, accounts/trials, connection rows, credential versions, or pilot secrets. Compatible migration 0004 remains after application rollback. Linking can be gated off independently. Remove temporary administrative bootstrap permissions regardless of success; stop if cleanup cannot be confirmed.

The approved Slice 3 task permits temporary emergency restoration of the old pilot as an explicitly reviewed recovery action. It is not an accepted normal SaaS path or automatic customer-serving fallback. This is narrower than the implementation plan's general prohibition on pilot rollback after accepted Phase 3. Before cutover, record the exact prior image/configuration and limits of that temporary recovery; application settings and RBAC are not rolled back merely by restoring an image.

After accepted cutover, only an account-aware revision is a normal customer-serving rollback target; absent a safe revision, fail closed. Phase 4 does not begin until Slice 3 live acceptance and closeout are approved.


## Approved repository prerequisites — manual MCP delivery

The accepted local Slice 3 checkpoint is extended by `.github/workflows/deploy-mcp.yml`, not by changing the control-only guard. `scripts/deploy/release.mjs` still refuses any changed/unknown MCP executable impact during its control-only promotion. No override is introduced.

The dedicated workflow is `workflow_dispatch` only, repository `robleon-git/connectwise-mcp`, branch `phase1-hardening`, initiating and rerun actor `robleon-git`, environment `connectwise-production`, existing OIDC identity and scoped RBAC. It shares production-delivery concurrency with the control workflow. There is no new GitHub reviewer gate. Codex must present the exact action and obtain owner approval before dispatch. `owner_action_approval` must be exactly `<action>:<reviewed 40-character SHA>`. Source SHA must match the workflow checkout; dirty tracked/untracked release source is rejected. These owner attestations are process evidence, not cryptographic proof that a browser test occurred.

Every action first runs PostgreSQL 18 integration/full tests, UI/backend/portal builds, ticket-card validation, lint, production/full audits and diff checks without OIDC permission. Only the delivery job receives OIDC. No database password or customer key enters GitHub. Only the operator—not GitHub—grants/removes bootstrap or candidate data-plane access.

Actions (each separately reviewed and approved):

1. `build`: capture the Single-mode production baseline and public smoke; require fresh owner ChatGPT connected:true and exact authenticated 39-tool attestations; publish both MCP and control images once under the reviewed SHA and retain immutable digests. Baseline includes old revision/image/traffic/probe count and an in-memory configuration fingerprint; raw environment/template values are not retained. Existing SHA tags are never overwritten. Partial publication stops for operator review.
2. Before `prepare-control`, verify the fixed public linking client; provider initialization requires its real client ID. The approved Option E keeps Descope rules empty/default Allow and creates no explicit access policy. `prepare-control` computes the MCP impact condition before any live mutation, verifies current readiness, and either proves control-only schema compatibility without touching the migration job or retains the existing MCP-affecting migration requirement. Then prepare and smoke the intermediate and final linking-enabled control revisions. Bootstrap plus mandatory cleanup must have succeeded before any required migration 0004 execution. No production MCP changes.
3. `promote-control`: recompute either the original changed-impact MCP-affecting condition or the separately evidenced control-only condition described below. Recheck reviewed source/digest, unchanged live MCP baseline, current traffic, retained rollback revision and current/candidate readiness. Pin old traffic before moving the candidate label, then promote and read back explicit traffic. Failure restores and verifies the recorded prior control revision. This does not bypass generic control-only `promote`.
4. Publish the portal through the existing separately approved portal-only action at the same reviewed SHA; complete ordinary customer identity linking.
5. `candidate`: create only `connectwise-mcp-slice3-candidate` in the product resource group/East US/shared ACA environment. Single mode, 0.5 CPU/1 GiB, 1–1 replicas, system identity plus existing ACR-pull identity. Apply operator public IPv4/32 allow restriction in the creation manifest, HTTPS only, no custom domain/routing. Creation uses an exact-resource ARM PUT with API 2024-03-01 after an absence check, avoiding CLI convenience code that could attempt implicit AcrPull grants. The manifest follows the [official Container Apps resource schema](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2024-03-01/containerapps). Production canonical resource/issuer/JWKS/scope remain fixed. No pilot configuration or secret access. Creation stops before data-plane grants; an operator separately approves/assigns customer GET-only and the single DB password scope to its new identity.
6. `accept-candidate`: check immutable image, Single mode, latest ready healthy revision, exact account-aware environment, operator-only ingress and no custom domains; record the owner's sanitized boolean acceptance record. No automatic production update. All acceptance fields are required; missing second-customer/denial/isolation evidence blocks acceptance.
7. `cutover`: separate owner action approval plus fresh production owner/inventory baseline and explicit temporary pilot-recovery acceptance. Recheck production baseline and accepted candidate. Retain rollback evidence before one production image/env update. Remove pilot credential/config/allowlist fields, retain Single mode, ingress/routing/probes. Confirm exact resulting revision/image and unchanged fingerprint of ingress, identities, explicit probes, scale/sizing/startup fields, then public smoke; production authenticated acceptance remains mandatory afterward.
8. `rollback`: explicitly approved temporary prelaunch emergency recovery only; copy the retained pilot revision/template and immutable image into a new Single-mode recovery revision. No migration/link/account/connection/credential deletions. Unexpected runtime state stops for read-only operator review; no automatic retry or guessed traffic operation.
9. `cleanup`: operator removes the exact candidate role assignments first; the workflow verifies none remain at the exact customer-vault and DB-password scopes (including inherited assignments) before deleting only the temporary candidate app. Cleanup requires role-assignment metadata read at those scopes, not subscription-wide enumeration or secret-value read. The operator checks the candidate identity for unexpected assignments as part of separate permission review.

Prior evidence is downloaded only from a successful manual run of this exact workflow/repository/branch/actors at the same source SHA. `slice3-mcp-release` retains nonsecret source/digests/baseline/revision/acceptance evidence for 90 days. Export reviewed rollback evidence for the release recovery window before artifact expiry. `.delivery` is excluded from Docker build context. No production cutover should begin without retained rollback evidence and existing pilot secrets/read permissions.

Example future dispatch, **do not run until live approval and committed source**:

```sh
gh workflow run deploy-mcp.yml --repo robleon-git/connectwise-mcp \
  --ref phase1-hardening -f action=build -f reviewed_sha="$CW_REVIEWED_SHA" \
  -f owner_action_approval="build:$CW_REVIEWED_SHA" \
  -f owner_baseline_connected=true -f baseline_read_tools_verified=true
```

Subsequent actions require `evidence_run` identifying the previous successful same-SHA run. `candidate` also requires `operator_cidr`; `prepare-control` requires the fixed `linking_client_id`; `accept-candidate` requires the exact allowlisted boolean JSON. `cutover` separately requires both fresh baseline confirmations and `emergency_pilot_rollback_approved=true`. Existing environment/OIDC federation is reused, not broadened; verify its subject accepts the new manual workflow before issuance. If a workflow-bound federation rejects it, stop for explicit identity-policy review. Scoped management rights to the production MCP and temporary candidate must be reviewed separately before live deployment; this repository work creates no assignments.

### Safe candidate SDK check

After candidate data-plane permissions/readiness are separately approved, the local command is:

```sh
node scripts/deploy/diagnose-mcp-candidate.mjs \
  https://connectwise-mcp-slice3-candidate.<actual-environment-domain>.eastus.azurecontainerapps.io/mcp
```

This reuses the existing loopback OAuth/PKCE/token verification and SDK initialize/initialized/tools-list helper. Only the exact candidate hostname pattern is accepted. Bearer tokens remain in memory and redirects remain blocked. Audience/resource are still https://api.monotorr.com/mcp. It checks the approved owner's exact 39 read-tool inventory, not second-user authorization, schemas, tool execution, or all acceptance cases. Those require separate real linked-principal SDK/ChatGPT checks and the runtime evidence below. The existing production diagnostic defaults are unchanged. Running the OAuth helper later creates a temporary public DCR client; it was not run during repository validation.

## Narrow authorization-order evidence

For hosted account-aware `/mcp` requests only, `mcp.access_evidence` is written to stderr once on request-handler completion. AsyncLocalStorage isolates concurrent contexts. The record contains only a generated request ID, allowlisted outcome and two bounded attempt counters. No endpoint is added. No identity/account/subject, secret name/reference, URL/company, tool arguments, headers, tokens, payloads or raw errors are accepted by the emitter. Existing HTTP logs use the same generated request correlation ID.

```json
{"event":"mcp.access_evidence","requestId":"<server-generated-uuid>","outcome":"access_denied","customerSecretGetAttempts":0,"connectWiseGetAttempts":0}
```

Safe retrieval, only after live approval and bounded acceptance requests:

```sh
node scripts/deploy/mcp-access-evidence.mjs candidate
node scripts/deploy/mcp-access-evidence.mjs production
```

The collector reuses existing active-revision/replica Azure console-envelope parsing and applies the narrow evidence whitelist again. Only these two fixed targets are allowed. It performs no OAuth flow, exposes no endpoint, prints no raw CLI/log lines, and returns nonzero when no access-evidence events are found. Correlate generated IDs with the existing method/status records; a retrieved snapshot alone is not proof of a particular test case. Existing `diagnose:live-mcp -- --azure-logs` can also recognize the new event.

Outcomes: authentication_denied, request_denied, access_denied, setup_required, service_unavailable, authorized. `authorized` means credential resolution passed; it does not assert the tool's downstream response succeeded. Exact customer GET attempts are counted immediately before each versioned SecretClient.getSecret call, including failures. ConnectWise attempts are counted immediately before validated/pinned GET dispatch; rejected non-GET, foreign URL, or private DNS targets do not increment them. Count semantics are application dispatch attempts, not a packet capture. These counters exclude infrastructure DB-password reads, JWKS retrieval and OAuth; entitlement gates precede customer-key retrieval, not DB authentication.

Unknown/unlinked and invalid entitlement: 0/0. Unconfigured account: 0/0. Malformed stored references: both validated before any customer GET, hence 0/0. First-secret failure: 1/0. Configured initialize/tools/list may resolve both secrets: 2/0 per HTTP request. An authorized single read tool request: normally 2/1. Multiple SDK HTTP requests produce separate records; do not aggregate discovery and tool calls as one request. Abrupt process termination can lose the final record; missing evidence is incomplete acceptance, never proof of zero calls. No general telemetry ingestion/dashboard is introduced.

## MCP-specific PostgreSQL deadlines

`databasePool` sets PostgreSQL startup parameters only when the role is `cw_mcp`: statement_timeout=5000 ms, lock_timeout=2000 ms, query_timeout=6000 ms. Existing max=3, acquisition=5000 ms and idle=10000 ms remain. Control/migration pools are unchanged; no ALTER ROLE/SERVER or global PostgreSQL setting is used. Small indexed identity/entitlement/connection lookups should finish well within 5 seconds; 2 seconds avoids waiting on contention, and the longer client deadline covers an unresponsive connection after server cancellation should have occurred. Each query is bounded independently, not the entire HTTP request. Timeout/lock/database uncertainty returns sanitized service_unavailable before customer-key retrieval or CW dispatch. PostgreSQL 18 integration verifies startup settings and actual statement cancellation; focused tests verify deadline/failure isolation.

## Rollback launch requirement

**TEMPORARY PRE-LAUNCH EMERGENCY RECOVERY ONLY.** The retained old pilot image serves only its prior approved identity, excludes newly linked SaaS customers, and does not enforce the new account/entitlement path. Newly linked customers remain stored/linked but receive the old allowlist denial; the prior pilot identity can use its prior pilot connection. This is not a normal post-launch rollback target. Preserve pilot image/secrets for the explicitly approved recovery window. Before general customer availability, retain and validate a known-good account-aware rollback image/revision/path so recovery cannot reintroduce the pilot authorization model.

Repository prerequisite validation does not authorize bootstrap, RBAC, Descope changes, migration, candidate creation, control/portal deployment or production cutover. No live acceptance PASS is claimed here.

## Candidate creation guardrails — repository checkpoint

The candidate PUT remains pinned to `Microsoft.App/containerApps` API `2024-03-01`. Its combined identity enum is exactly `SystemAssigned,UserAssigned`: the system identity and existing `connectwise-mcp-pull-id` remain unchanged. Offline regression tests validate the complete generated resource against the official Azure schema under `src/__tests__/fixtures/azure-containerapps-2024-03-01/`. `provenance.json` records source URLs and SHA-256 hashes of the unmodified schema files. The test adapts draft-04 identifiers for the existing AJV validator; validation rules and enum values are preserved. No dependency or runtime changes are required.

Candidate creation also requires `Microsoft.App/managedEnvironments/join/action`. The source definition is `deployment/azure/mcp-environment-join-role.json`, containing that action alone and no data-plane permissions. Its resource-group `AssignableScopes` permits defining the custom role; it does **not** authorize a resource-group assignment. The sole intended temporary assignment is to GitHub OIDC principal `9c8fd37b-b308-4a9d-beef-018459764029` at this exact environment resource:

```text
/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-dev-eastus-rg/providers/Microsoft.App/managedEnvironments/monotorr-prod-aca-env
```

Future operator-approved actions, not performed by repository validation:

```sh
az role definition create --role-definition @deployment/azure/mcp-environment-join-role.json --output none
az role assignment create \
  --assignee-object-id 9c8fd37b-b308-4a9d-beef-018459764029 \
  --assignee-principal-type ServicePrincipal \
  --role "ConnectWise temporary MCP environment join" \
  --scope /subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-dev-eastus-rg/providers/Microsoft.App/managedEnvironments/monotorr-prod-aca-env \
  --query id --output tsv
```

Capture the returned assignment ID. Remove that **exact assignment** using `az role assignment delete --ids <captured-assignment-id> --output none` immediately after the approved candidate operation, on success or failure; verify absence before any next step. The custom role may remain defined but unassigned. This supplements the separately reviewed temporary candidate-creation permission and does not grant environment write/delete, networking, vault/database access, or RBAC administration. Neither assignment nor candidate retry is authorized by this source checkpoint.

MCP delivery failures now emit only `mcpReleaseSucceeded:false`, an allowlisted stage and an allowlisted category. Candidate stages distinguish payload validation/writing, existence check, ARM PUT and evidence persistence; baseline checks remain fail closed. Known structured Azure error codes map to authorization, invalid-payload, resource-conflict or referenced-resource categories. Unknown, unstructured or ambiguous errors become `unknown`. Raw command stderr/stdout, error messages, response bodies, headers and command/environment values are never emitted. The shared control-only Azure helper is unchanged. All failures retain a nonzero CLI exit; no automatic retry or guard bypass is introduced.

After this checkpoint, a **new separately approved immutable build** must produce same-SHA release evidence before any candidate retry. Existing image provenance must not be relabeled. The next live permission request must include the exact temporary environment assignment and mandatory cleanup above. Existing MCP runtime/image/configuration/routing/revision/traffic/probes, Descope, customer data and identity bindings remain outside this correction.

### Slice 3 computed control-only reconciliation

`prepare-control` and `promote-control` now distinguish the original MCP-affecting lane from a computed control-only condition. The latter requires identical names and emitted contents for all 39 MCP executable modules, equal protected dependency/build inputs, known ancestor source SHAs, and equal validated migration manifests and SQL checksums. Missing, changed or ambiguous evidence never qualifies as control-only. The original changed-impact lane and the generic control-only promotion guard remain intact; no skip-migration or review-bypass input exists.

Preparation proves compatibility and current control readiness before any live mutation. It verifies the live control revision/image and explicit 100% traffic, pins that revision before moving labels, and retains rollback evidence. When the computed condition is control-only, it makes **zero migration-job update/start calls**. The MCP-affecting lane retains the existing migration execution requirement. Both the intermediate control candidate and the final linking-enabled revision must pass readiness/smoke checks. Candidate readiness checks its required database migration IDs and checksums using its existing private runtime database connection; GitHub receives no database credentials.

Promotion recomputes the classification and schema proof and matches the recorded condition. It verifies the candidate and the exact retained rollback revision/image, current traffic, and current/candidate readiness before changing labels or traffic. Traffic is read back after each explicit setting. Failed promotion/readback/post-promotion smoke restores the preverified prior control revision, verifies restored traffic and readiness, and fails the release; failed recovery stops for operator review. Neither control action deploys or modifies either MCP application. Accepted MCP candidate evidence and the original production MCP baseline are retained unchanged.

The workflow, artifact, release state and image remain bound to the exact same reviewed SHA. This correction adds no cross-commit reuse exception. After a new tooling commit, old `eb35` artifacts cannot be adopted as artifacts of the new source: the existing delivery model requires fresh same-SHA build/evidence and renewed candidate provenance/acceptance before any subsequent MCP cutover. Retain earlier accepted evidence as historical evidence. Repository validation does not authorize a build dispatch, control preparation/promotion, migration, or MCP deployment. Each live action still requires its explicit Codex approval.
