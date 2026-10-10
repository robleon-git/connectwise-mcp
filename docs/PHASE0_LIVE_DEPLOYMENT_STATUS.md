# Phase 0 live deployment preflight — 2026-10-09

Status: intended live PostgreSQL target is **`monotorr-cw-db-01`, North Central US, PostgreSQL 18/B1ms**. No creation/retry is authorized by this repository update. Initial RG/deployment identity/federation/portal shell exist; Phase 0 live acceptance is not complete. Earlier names/regions below are historical observations, not current deployment targets.

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
