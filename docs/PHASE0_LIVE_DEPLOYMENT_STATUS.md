# Phase 0 live deployment and closeout status

## Current delivery approval policy — approved 2026-10-10

The owner approved moving the sole human approval gate into Codex. Before dispatch/rerun, Codex presents the exact live-changing action and receives explicit owner approval. The `connectwise-production` required-reviewer rule was removed and verified; branch/environment restrictions, manual-only events, exact OIDC/RBAC, CI/audit/evidence/smoke/rollback safeguards remain. The workflow additionally restricts delivery to the exact repository/branch and owner initiating/rerun identities. No deployment or Azure mutation is authorized by this policy change. GitHub-review entries below are historical; refer to the current runbook for subsequent releases. Codex approval is procedural, not independently attested by GitHub. Settings readback verifies no required-reviewer rule, unchanged exact `phase1-hardening` branch policy (including its policy ID), and `can_admins_bypass=false`. Published workflow guards were verified before removing review. All 452 tests (including PostgreSQL 18 integration), build, lint, both audits (0 vulnerabilities) and diff checks passed. No deployment was triggered and no Azure/RBAC/MCP settings changed.

Status: **Phase 0 live acceptance PASS**, completed 2026-10-10. Live database is `monotorr-cw-db-01`, North Central US, PostgreSQL 18/B1ms; portal/control API, private bootstrap cleanup/migrations, rollback, MCP regression, owner dogfood and notification tests passed. This repository closeout includes the validated activation correction and completion evidence; no deployment or Azure mutation is performed. Earlier pending statements below are historical checkpoints, not current status.

## Historical preflight: source and GitHub

- Reviewed checkpoint `920397eb1847fbccb363435b02eddb22d9092416` was pushed by fast-forward to `phase1-hardening` as authorized. No merge or push to `main`.
- The five pre-existing, explicitly excluded diagnostic changes remain local and uncommitted; deployment source is the reviewed committed branch.
- GitHub CI run [38003398946](https://github.com/robleon-git/connectwise-mcp/actions/runs/38003398946) completed successfully, including builds, card validation, lint, real PostgreSQL tests, production/full audit and diff gates.
- With explicit owner approval, the repository default branch was changed from `main` to `phase1-hardening` so its reviewed manual workflow can be registered. No workflow dispatch, deployment identity, production environment permissions or Azure role assignment was performed.

## Existing MCP baseline

- Revision `connectwise-mcp-pilot--0000005`; Single mode; latest revision 100% traffic; zero explicit probes.
- Image `monotorrdevacr6689.azurecr.io/connectwise-mcp@sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`.
- Public health, protected-resource metadata and anonymous 401/authentication challenge checks passed.
- Existing safe OAuth helper completed real resource-token verification, approved-user check, authenticated initialize and tools/list; protocol `2025-11-25`, exactly 39 expected read-only tool names matched.
- No ConnectWise tool execution or manual production ChatGPT dogfood test was performed during this preflight. The V1 customer/account/entitlement model is not implemented yet.
- Raw tokens, claims, passwords, request/response bodies and customer data are not stored. Sanitized observations are under ignored `.delivery/phase0-live-preflight.json` and `.delivery/mcp-baseline.json`.

## Historical East US restriction and approved resolution

The approved subscription/tenant matched the runbook. `monotorr-connectwise-prod-rg` does not yet exist. PostgreSQL name `monotorr-cw-prod-pg` is available.

`az postgres flexible-server list-skus --location eastus` returned no supported server editions or versions, with this nonsecret Azure capability reason:

> Provisioning is restricted in this region. Please choose a different region. For exceptions to this rule please open a support request with Issue type of 'Service and subscription limits'.

Consequently, the then-approved General Purpose `Standard_D2ds_v5` / PostgreSQL 17 (historical preflight) / 32 GiB / 14-day backup configuration cannot currently be verified/provisioned in East US. At that preflight, no alternate region/SKU, public firewall access or shared-database fallback had been selected.

On 2026-10-09 the owner approved **East US 2** for `monotorr-cw-prod-pg`, keeping database `connectwise`; the subsequent approved launch-size decision is PostgreSQL 18/Burstable `Standard_B1ms` (1 vCPU/2 GiB)/32 GiB Premium SSD/autogrow/14-day PITR, HA Disabled and geo-redundant backup Disabled. Subscription capabilities advertise the approved SKU/version with no region restriction. Public access stays Disabled. Existing ACA/VNet and the new private endpoint remain East US; reuse the existing private DNS zone/link and add only the new server record. No VNet peering/VPN/additional network, East US exception, or shared Monotorr database fallback. Cross-region latency/traffic cost is an accepted V1 tradeoff.

The exact resource inventory/costs and proposed actions are in [the delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md#approved-north-central-us-database-placement--repository-baseline-2026-10-10). Resource creation and deployment still require final approval. One separate conflict was found: the approved portal hosting uses Static Web Apps, whose subscription-advertised locations exclude East US. Its earlier command selected East US 2; the new constraint requires the portal to remain East US. Portal creation is withheld until the owner explicitly resolves that conflict. No hosting change or region exception is assumed.

## Live outcome

No Azure resources, identities, RBAC, private endpoints, DNS records, database secrets, database roles or deployments were created/changed. Descope policy, MCP auth/configuration, ConnectWise credentials/Client ID, MCP routing/traffic/probes and existing pull assignments remain untouched. Bootstrap/migration/API/portal/rollback and owner dogfood acceptance remain pending. Do not begin Phase 1.

## Approved launch-size cost and operational baseline

Standard_B1ms is intentionally approved for the small V1 control-plane workload. Fixed compute/storage/private-endpoint estimate is **$23.39/month**, with traffic, excess backup storage, monitoring and other application costs additional. See [cost baseline](PHASE0_COST_BASELINE.md) and runbook B1ms operations for CPU-credit/CPU/memory/connection/query-latency/storage monitoring, current max-3 service/max-1 bootstrap pools and B2s versus General Purpose upgrade triggers. No monitoring resources or query-latency instrumentation have been deployed by this plan update.

## Authorized execution checkpoint — 2026-10-09

The owner approved the full documented Phase 0 creation/deployment plan and resolved portal placement to East US 2. Earlier no-resource statements above describe the preflight, not this checkpoint. Native six-rule metric-alert verification requires no diagnostic-log ingestion; budget up to $0.60/month after free allowances.

Created successfully:
- `monotorr-connectwise-prod-rg`, East US metadata.
- `cw-deploy-identity`, East US; client ID `2c3d560a-0585-4c65-b1d0-2f2b67f1392c`; principal ID `9c8fd37b-b308-4a9d-beef-018459764029`. No RBAC role assignments yet.
- `github-connectwise-production` federation, issuer `https://token.actions.githubusercontent.com`, subject `repo:robleon-git/connectwise-mcp:environment:connectwise-production`, audience `api://AzureADTokenExchange`.
- `connectwise-portal`, Standard SWA, East US 2; generated hostname `black-bush-04c7a8b0f.5.azurestaticapps.net`. Portal assets not published/smoke-tested yet.

At that historical checkpoint, subscription/tenant matched; B1ms/PostgreSQL 17/autogrow advertised; server name available. Existing MCP anonymous health/metadata/401 smoke passed, and current baseline captured under ignored `.delivery/`. No MCP mutation or existing AcrPull change.

Next required operator step is the runbook's secure Portal creation of the B1ms server and NEW `cw-bootstrap-db-password` secret. No password is requested in chat, read through CLI, generated into a project file, or passed in argv. Database, endpoint/DNS, bootstrap/cleanup, migration, control API/rollback, OIDC workflow, alerts and portal/MCP authenticated/owner dogfood acceptance remain pending. No PASS claim or Phase 1 implementation.

## Approved PostgreSQL 18 baseline update

The owner approved PostgreSQL **18** as the V1 baseline for all new deployments and Phase 0 CI/integration validation. This supersedes the earlier version-17 baseline, without changing B1ms sizing, data architecture, private networking, storage, PITR/HA/public-access decisions. The reported East US 2 B1ms/version-18 creation failed with `SkuNotAvailable`; no retry or Azure mutation is authorized by this baseline update. North Central US B1ms is the next candidate pending explicit provisioning approval and allocation availability. Repository compatibility validation does not prove Azure allocation capacity.

### PostgreSQL 18 repository validation

Validated locally against disposable official `postgres:18-alpine`, server version **18.6**, loopback-only synthetic test configuration; container removed after tests. Both focused real database bootstrap/migration tests passed. Full regression with database integration enabled passed **430 tests in 20 files**, including both database tests (none skipped). UI build, TypeScript build, ticket-card self-contained/output validation, portal build, lint, production audit (0 vulnerabilities), full audit (0 vulnerabilities) and final diff checks passed. CI/manual delivery PostgreSQL services now use `postgres:18-alpine`; integration tests explicitly assert major version 18 before bootstrap/migration. No compatibility issue found, no application/data architecture changes, Azure operations, provisioning retry or commit performed. Repository version baseline is ready for the next explicitly approved North Central US B1ms attempt; allocation availability remains unproven.

## Current approved live target — 2026-10-10

Server **`monotorr-cw-db-01`**, region **North Central US**, database `connectwise`, PostgreSQL 18, Standard_B1ms, 32 GiB Premium SSD, autogrow Enabled, 14-day PITR, HA Disabled, geo-backup Disabled, public access Disabled, administrator `cw_bootstrap_admin`. API/jobs/private endpoint/VNet remain East US; portal remains East US 2. Reuse the private endpoint subnet and private DNS zone/link; new endpoint target/DNS record must refer to `monotorr-cw-db-01.postgres.database.azure.com`. Preserve historical old-name troubleshooting above. No Azure changes, provisioning retry or Phase 1 implementation in this task.

## Live execution checkpoint — 2026-10-10

Owner confirmed server/secure bootstrap secret creation and authorized continuation. Metadata verifies `monotorr-cw-db-01` Ready in North Central US; PostgreSQL 18, Burstable Standard_B1ms, 32 GiB Premium_LRS/P4, 120 IOPS, autogrow Enabled, 14-day PITR, HA/geo-backup/public access Disabled, administrator `cw_bootstrap_admin`. Bootstrap secret-name metadata confirms Enabled; no password was retrieved or printed.

Created dedicated `connectwise` database (UTF8/en_US.utf8), East US `pe-connectwise-prod-postgres` with Approved connection/Succeeded state, and `default` zone group using the existing DNS zone. New A record `monotorr-cw-db-01` points to **10.42.0.37**; existing `monotorr-dev-db` record stays **10.42.0.36**. Backend DNS/TLS connectivity from ACA still requires private-job validation; endpoint approval alone does not prove it.

Owner explicitly approved scoped commit/push: `0829f12dfc26a75aeba97a53fe6469e8449164a1` (12 approved Phase 0 files). First protected build 38024440285 stopped before OIDC publication: all 361 tests passed but PostgreSQL integration teardown emitted an uncaught forced-disconnect error. Test-only bounded wait for zero backend connections replaces FORCE deletion; no production-code change or error suppression. Correction `c156d856a592c2e4cda95b751f2043d65c715540` committed/pushed; local PostgreSQL 18 full validation passed 431 tests, builds/lint and both audits 0.

Protected GitHub environment `connectwise-production` now requires reviewer `robleon-git`, disallows administrator bypass, and permits only branch `phase1-hardening`; nonsecret client-ID variable set. Corrected workflow [38024602371](https://github.com/robleon-git/connectwise-mcp/actions/runs/38024602371) passed verify gates and is waiting for owner review before the OIDC/image-publication job. No image has been published by this run yet.

Dedicated OIDC principal `9c8fd37b-b308-4a9d-beef-018459764029` has exactly AcrPush on the shared ACR, Reader on the shared ACA environment, and ConnectWise Portal Deployment Token custom role on the new SWA. No Vault data-plane/DB access, API/job Contributor grants (resources not created), subscription Owner, bootstrap access or existing AcrPull changes.

Created `ag-connectwise-db-ops` with owner-approved notification recipient and six enabled static single-resource metric alerts: credits, sustained CPU, memory, connection saturation, connection failures and storage. Azure CLI registered Microsoft.Insights as the prerequisite. No PostgreSQL diagnostic-log ingestion was added. Alert delivery test and continuous query-latency coverage remain pending.

The runbook database-create argument was corrected to installed CLI syntax `--name connectwise`; prior argument failure changed nothing. Existing MCP anonymous regression passed again. No MCP image/routing/traffic/revision/probe/Descope changes, no existing Monotorr PostgreSQL change, no customer credentials accessed. Five unrelated local diagnostic changes remain uncommitted.

Remaining: owner GitHub review → OIDC image build → new resources/private bootstrap and cleanup → migration → API readiness/rollback → portal publication/smoke → authenticated MCP regression/manual owner dogfood. Phase 0 remains **PENDING**, not PASS. Fixed PG/endpoint estimate $23.39/month; six alerts up to $0.60/month; Standard portal about $9/month; usage and future API/job compute additional.

### OIDC subject correction — 2026-10-10

Owner approved protected build review. Azure/login failed before publication with AADSTS700213: GitHub uses immutable subject `repo:robleon-git@202705822/connectwise-mcp@1404568890:environment:connectwise-production`, while the initial reviewed credential used the earlier name-only format. Verified owner ID 202705822 and repository ID 1404568890 via GitHub metadata and current official OIDC documentation. Updated only the existing new deployment identity's federated credential to that exact immutable subject; issuer/audience, protected environment/reviewer and Azure RBAC unchanged. No wildcard trust, broader permissions or GitHub subject downgrade. Reran only failed delivery jobs at the same reviewed source SHA; image publication/deployment still requires protected workflow success.

### Protected publication and evidence correction — 2026-10-10

After the owner's renewed review, run 38024602371 successfully authenticated through OIDC and published source `c156d856a592c2e4cda95b751f2043d65c715540` as `monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:42986abda600f846c682ea0653710d819fdec4546e33cb55b4870c6c24d1e8de`. ACR metadata independently matches the build result. No new API or jobs were deployed: the required release artifact was absent because upload-artifact excludes hidden directories by default, including `.delivery`.

Correction `3ca2f48` explicitly uploads only `.delivery/built-image.json` and `.delivery/control-release.json`, enables hidden-file inclusion and fails if evidence is absent. A regression test covers this nonsecret allowlist. Full local PostgreSQL 18 regression passed **432 tests in 20 files**, builds/lint/ticket-card/portal validation and both audits (0 vulnerabilities) passed. Only the two approved workflow/test files were committed/pushed; unrelated local diagnostic work remains excluded. New protected build [38025723476](https://github.com/robleon-git/connectwise-mcp/actions/runs/38025723476) must pass verification and owner review before further image publication. Existing MCP, credentials, RBAC and routing were not changed by this correction. Phase 0 remains pending.

### Private bootstrap completed — 2026-10-10

Protected run 38025723476 passed and published source `3ca2f48d87d898097bd1773a2b754ace435de8d3` with retained release evidence. ACR digest independently verified: `sha256:c0729bfe39ab31fda027c8b7131d4019e029ed15d11e686c05963a9de87fdb75`. Created only new East US control API and separate migration/bootstrap jobs using that immutable image. API hostname: `connectwise-control-api.purplesea-558e8ead.eastus.azurecontainerapps.io`; initial revision `connectwise-control-api--ch5q1fk`.

One-shot private bootstrap execution `connectwise-bootstrap-hal4dnb` succeeded (05:01:45–05:02:26 UTC). Helper removed its three reviewed secret-scoped grants, disabled `cw-bootstrap-db-password`, and deleted the job; independently verified no bootstrap grants/job and disabled secret metadata. This proves private PostgreSQL DNS/network/TLS, administrator authentication, secret resolution/write and constrained DB role initialization. No passwords were retrieved by the operator or printed.

API system principal `eeed932b-44aa-4c2d-9f2a-6796b942961a` has Secrets User only on `cw-control-db-password`; migrator `92efdf1e-7fc5-45ba-ba61-1588710cc5f4` only on `cw-migration-db-password`. Deployment principal now additionally has Contributor only on the new control API and migration job. No permanent bootstrap/admin service or runtime migration privilege. Migration/readiness, API rollback, portal publication and final dogfood acceptance remain pending. Existing MCP revision `connectwise-mcp-pilot--0000005` still has 100% traffic and unchanged digest.

### Migration and candidate validation — 2026-10-10

Protected prepare run 38026243231 succeeded, including OIDC-triggered private migration `connectwise-migrate-kkqq66u`, candidate readiness, candidate/control API smoke and unchanged MCP smoke. The initial operator management-plane migration `connectwise-migrate-0c58qrn` also succeeded; migration is idempotent and no schema reversal or password retrieval was performed. Candidate `connectwise-control-api--p0-3ca2f48d87d8` uses the verified immutable digest above. Retained evidence records previous revision `connectwise-control-api--ch5q1fk` and its same initial image/source, allowing a revision/traffic rollback exercise (not an image-change rollback demonstration). The main control API hostname independently passed readiness and closed-product-route smoke.

Protected promotion run 38026568453 is in progress. Portal delivery, rollback exercise and final owner dogfood remain pending. Alert receiver test attempts were rejected by Azure notification validation/REST; no action-group/rule/recipient configuration was changed. Operator Portal test/inbox confirmation remains required; no alert delivery PASS is claimed. No diagnostic-log ingestion was added.

### Approved traffic-only promotion and rollback — 2026-10-10

Owner explicitly approved traffic-only retry using the existing healthy candidate, without image rebuild, bootstrap or migration. Promoted `connectwise-control-api--p0-3ca2f48d87d8` to 100%, independently verified prior revision `connectwise-control-api--ch5q1fk` at 0%, and passed control API health/readiness/gated-route and unchanged MCP smoke. Exercised documented rollback to the recorded prior revision at 100% (candidate 0%); both smoke suites passed. Restored the approved candidate to 100% (prior 0%) and repeated both smoke suites successfully. Both revisions remain active/healthy on the same immutable image; this demonstrates revision/traffic rollback, not recovery from a different application image. Revision mode, candidate contents, existing MCP and database state were not changed. Evidence retained in ignored `.delivery/traffic-only-exercise.json`.

Narrow repository-only activation correction remains uncommitted: active revisions skip redundant activation; unknown state and inactive activation failures fail closed. 45 focused delivery tests and all 439 tests against PostgreSQL 18 passed; build/lint/both audits/diff passed. No rebuild/publication of the control image was performed for the approved traffic-only retry.

Portal-only protected workflow [38057502285](https://github.com/robleon-git/connectwise-mcp/actions/runs/38057502285) started at reviewed committed source. It builds/tests portal assets but does not rebuild a container image, rerun bootstrap or invoke migration. Authenticated inventory helper started interactively with `--expect-read-tools`; outcome and manual production ChatGPT owner dogfood remain pending.

Authenticated regression completed successfully: verified MCP resource token; approved user `/sub` matched; SDK initialize/tools-list succeeded with protocol `2025-11-25`; exactly **39 tools**, exact inherited read-only inventory matched. Tokens were held only in memory and not logged or persisted. Existing MCP remains Single mode, revision `connectwise-mcp-pilot--0000005`, 100% traffic, unchanged image `sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`. Portal verification passed and awaits its protected review; owner was asked to perform the distinct production ChatGPT `cw_test_connection` dogfood test using the ordinary customer identity. No final Phase 0 PASS until the remaining acceptance evidence is obtained.

### Portal publication / smoke blocker and confirmed dogfood — 2026-10-10

Owner confirms production ChatGPT, using the ordinary customer identity, invoked `cw_test_connection` and returned `connected:true`. Owner dogfood PASS is based on this explicit human confirmation, independently of the SDK inventory result. No implicit admin privileges or existing MCP configuration changes were introduced.

Portal-only run 38057502285 successfully authenticated through OIDC, retrieved the masked transport token, downloaded tested assets and published the portal. Deployed smoke failed: `/` is 200 with root/assets present, `/api/account` is 404, but `/.auth/login/aad` and `/.auth/login/github` return 302. Broad `/.auth/*` status rule did not block these platform login routes. This is a NEW portal configuration defect; no existing MCP change is required.

Prepared repository-only correction adds explicit provider-specific 404 rules ahead of the existing wildcard, following [Microsoft's provider-blocking documentation](https://learn.microsoft.com/en-us/azure/static-web-apps/authentication-authorization). Existing fallback exclusions, `/api/*` block, headers and smoke expectations remain intact. Four focused cases cover explicit provider blocks and rejection of login redirects; 33 foundation tests and full **443 tests in 20 files** (including PostgreSQL 18 integration) passed. UI/core/portal builds, ticket-card validation, config artifact equality, lint, both audits (0 vulnerabilities) and diff checks passed. Only `portal/public/staticwebapp.config.json` and `src/__tests__/delivery-foundation.test.ts` are needed for this correction; not committed/pushed/redeployed yet. Local activation correction and unrelated diagnostic work remain separate and uncommitted.

Phase 0 is not a final PASS: portal smoke must pass after reviewed portal-only correction deployment. Operator alert-delivery test still returns BadRequest; manual Portal test/inbox confirmation is pending. Six native metric rules remain enabled; no diagnostic-log ingestion or broader permissions added. Control API promotion/rollback/restoration, private bootstrap/cleanup/migration, authenticated 39-tool regression and owner dogfood have passed. No Phase 1 work started.

### Portal correction checkpoint

Owner explicitly approved committing/pushing only the provider-blocking config and its tests. Commit `23e8396e19bf90ffccbe7d2a561eb1ec8e94b651` (`Block built-in portal login providers during Phase 0`) contains exactly those two files. No release-script correction, unrelated local diagnostic changes or documentation work was included. Portal-only protected run [38058407027](https://github.com/robleon-git/connectwise-mcp/actions/runs/38058407027) started at this source, with no container image build/bootstrap/migration/control API deployment. Final deployed smoke is pending.

## Final live acceptance checkpoint — 2026-10-10

**Phase 0 live deployment and acceptance: PASS.** This closeout includes the validated activation-state correction and deployment evidence. The accepted live promotion used the explicitly authorized traffic-only retry; committing the correction does not deploy a new image or change the healthy candidate. No Phase 1 implementation or authorization to begin Phase 1.

Corrected portal run [38058407027](https://github.com/robleon-git/connectwise-mcp/actions/runs/38058407027), source `23e8396e19bf90ffccbe7d2a561eb1ec8e94b651`, completed successfully: verify, OIDC, publication and deployed smoke. Independent portal, control API and existing MCP smoke all passed again. Portal: https://black-bush-04c7a8b0f.5.azurestaticapps.net. Control API: https://connectwise-control-api.purplesea-558e8ead.eastus.azurecontainerapps.io.

Owner confirms the action-group test email was received and the selected health-check sample completed successfully. This closes operator notification delivery validation; it is human-confirmed evidence, not a successful CLI notification test or a forced production metric-threshold firing. Six database-only native metric alerts remain enabled. No PostgreSQL diagnostic setting/log ingestion was added.

### Created resources and placement

| Resource | Region / configuration | Result |
| --- | --- | --- |
| `monotorr-connectwise-prod-rg` | East US resource-group metadata | Dedicated product lifecycle boundary |
| `monotorr-cw-db-01` / `connectwise` | North Central US; PostgreSQL 18; Standard_B1ms; 32 GiB Premium SSD; autogrow; 14-day PITR; HA/geo-backup/public access Disabled | Ready, private bootstrap and migrations passed |
| `pe-connectwise-prod-postgres` and generated NIC | East US; existing endpoint subnet | Succeeded / Approved; target only new server |
| New `monotorr-cw-db-01` DNS record / zone association | Existing global private zone/VNet link | 10.42.0.37; existing `monotorr-dev-db` 10.42.0.36 preserved |
| `cw-deploy-identity` / GitHub federation | East US; exact repository immutable subject and protected environment | OIDC build, migration/candidate, portal delivery verified |
| `connectwise-control-api` | East US; shared ACA environment; Consumption 0.5 vCPU / 1 GiB; new API Multiple mode | Candidate Healthy / 100%; prior Healthy / 0%; health/readiness/gated routes PASS |
| `connectwise-migrate` | East US; separate manual job/system identity; same private path | Operator and GitHub management-plane invocations Succeeded |
| `connectwise-bootstrap` | East US; temporary bounded manual job/system identity | Succeeded; deleted; no remaining grants; admin password secret Disabled |
| `connectwise-portal` | East US 2; Standard SWA | Published shell / smoke PASS; both built-in provider login routes blocked |
| `ag-connectwise-db-ops` + six metric alerts | Global monitoring; only new PostgreSQL scope | Enabled; owner-confirmed test and email receipt |
| New DB secret names | Existing `cw-mcp-kv`, East US | Runtime/migrator passwords generated in private job memory; admin secret disabled after cleanup |

### Exact identity/RBAC outcome

Deployment UAMI client `2c3d560a-0585-4c65-b1d0-2f2b67f1392c`, principal `9c8fd37b-b308-4a9d-beef-018459764029`: AcrPush only shared ACR; Reader only shared ACA environment; Contributor only NEW control API and migration job; custom portal deployment-token role only NEW SWA. Exact immutable GitHub federation subject: `repo:robleon-git@202705822/connectwise-mcp@1404568890:environment:connectwise-production`; unchanged issuer/audience. No subscription Owner, Vault data-plane access or DB passwords for GitHub.

Runtime system principal `eeed932b-44aa-4c2d-9f2a-6796b942961a`: Key Vault Secrets User only `cw-control-db-password`. Migration system principal `92efdf1e-7fc5-45ba-ba61-1588710cc5f4`: Secrets User only `cw-migration-db-password`. Distinct constrained DB logins `cw_control` and `cw_migrator`, max-three pools; runtime not a migrator/admin. Temporary bootstrap principal `d9aa8c32-6b5d-41f0-aee7-a97a57801079` has zero remaining assignments; job absent and bootstrap secret disabled independently rechecked. Existing ConnectWise/Monotorr image-pull identities and AcrPull assignments were not changed.

### Release, recovery and regression results

Final control revision: `connectwise-control-api--p0-3ca2f48d87d8`, 100% traffic. Immutable image: `monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:c0729bfe39ab31fda027c8b7131d4019e029ed15d11e686c05963a9de87fdb75`. Prior `connectwise-control-api--ch5q1fk` is Healthy, active, 0%. Promotion → rollback to prior → restore candidate all verified at 100%/0%, with smoke at each step. Both use the same image: revision/traffic rollback passed, not an application-version recovery demonstration. No bootstrap/migration rerun for traffic-only retry; no schema/secret rollback.

Existing MCP remains revision `connectwise-mcp-pilot--0000005`, Single mode, 100% traffic, image `sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3`. Anonymous smoke, real-token SDK initialize/tools-list and exact **39 read-only tools / zero writes** inventory PASS. Owner explicitly confirms production ChatGPT's `cw_test_connection` returned `connected:true` with the ordinary customer identity. No MCP image, routing, DNS, traffic, revision mode, probes, Descope, customer credentials or existing Monotorr database changes.

### Costs, deviations and remaining closeout

Accepted fixed PostgreSQL + endpoint estimate **$23.39/month**; Standard portal about **$9/month**; six native alerts up to **$0.60/month** depending on allowances; new API estimate **$11.83/month idle to $39.42/month active**, plus usage. Combined dedicated estimate approximately **$44.82–$72.41/month**, excluding shared-infrastructure allocation, bandwidth, excess backup storage, Vault/logging transactions and job executions. These are estimates, not billed actuals. No additional log ingestion was required for metric alerts.

Recorded deviations were corrected or explicitly approved: PostgreSQL name/region/version updates after failed original allocation; installed CLI database-name syntax; GitHub immutable OIDC subject; bounded PostgreSQL test teardown; hidden release artifact publication; direct owner-approved traffic-only retry after redundant activation Conflict; explicit SWA provider blocks after wildcard did not prevent platform login redirects. Microsoft.Insights prerequisite registration was performed by the CLI. No broader RBAC or shared-service mutation was used to work around failures. CLI alert test attempts were rejected; owner Portal test completed successfully instead.

The owner approved this repository closeout with the activation correction/evidence; unrelated local diagnostics remain excluded. Before V1 launch, complete the already-documented aggregate query-latency coverage/baseline and workload-calibrated B1ms capacity review; these are not claimed implemented by native metric alerts. Permanent portal/API hostnames must be decided before Phase 1 auth redirect/session configuration. No live deployment acceptance blocker remains after successful portal smoke and owner-confirmed alert/dogfood tests.
