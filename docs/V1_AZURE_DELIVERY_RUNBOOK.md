# V1 Phase 0 Azure Delivery Runbook

Status: **Phase 0 live acceptance PASS (2026-10-10)**; this runbook records the completed foundation and repeatable owner-approved delivery process. Database `monotorr-cw-db-01` is PostgreSQL 18/B1ms in North Central US, private-only. Bootstrap cleanup, migrations, API promotion/rollback, portal smoke, 39-tool MCP regression, owner dogfood and alert delivery passed. No Phase 1 work or new Azure/deployment operation is authorized by repository closeout. See [live status](PHASE0_LIVE_DEPLOYMENT_STATUS.md).

Authority: [V1 architecture](V1_PRODUCT_ARCHITECTURE.md), [implementation plan](V1_IMPLEMENTATION_PLAN.md). Approved delivery decisions supersede the earlier proposal to reuse Monotorr's PostgreSQL server or change the existing MCP revision mode/probes.

## Current production baseline and routing (read-only)

Observed 2026-10-08: `connectwise-mcp-pilot--0000005`, healthy/provisioned, single-revision mode, latest revision receives 100% traffic, image `monotorrdevacr6689.azurecr.io/connectwise-mcp@sha256:31fdec08dbe8a8a912275958e9314575745c7f77d0ae02cb8f3e364221f708f3` (ACR tag `stageb-ca4d85f`). No explicit probes are configured. Keep that configuration unchanged.

`api.monotorr.com` CNAME names `monotorr-api-prod.purplesea-558e8ead.eastus.azurecontainerapps.io`; the shared environment's address is the resolved address. The MCP app has no listed hostname binding. Raw ARM GET using API 2025-07-01 also reports null custom-domain bindings; Monotorr API remains on its distinct monotorr-api:v0.1.12 image, while MCP uses the captured ConnectWise digest. Token-free `/health` returned 200, protected-resource metadata returned 200 with canonical resource/Descope issuer/connectwise.read, and POST `/mcp` returned 401 with a challenge. A CNAME naming another app in the same environment does not itself establish application-level proxying. Exact ingress host/path routing remains unresolved from the available app metadata/current Monotorr source; this is a recorded unknown, not permission to repoint DNS. No DNS/domain/path/routing changes are part of Phase 0.

Nonsecret observed facts are captured in `deployment/azure/production-baseline.json`. Refresh with `npm run baseline:production` (read-only Azure/DNS/HTTP; writes nonsecret evidence under ignored `.delivery/`) before an actual release. Do not dump Container App env values, secret values, raw logs, or OAuth tokens into the baseline.

The existing diagnostic command `npm run diagnose:live-mcp -- --expect-read-tools` performs the operator's OAuth + SDK initialization/discovery. It may perform ordinary temporary OAuth client registration. Execute only as an authorized interactive operator. It is not run by CI and does not constitute the manual ChatGPT dogfood test.

## Exact proposed resource placement and changes — not executed

| Resource | Resource group | Planned action |
| --- | --- | --- |
| `monotorr-connectwise-prod-rg` | New | Create in East US |
| `connectwise-control-api` | New group | New health-only Container App, multiple-revision mode, separate system identity and explicit probes |
| `connectwise-portal` | New group | Standard Static Web App approved in East US 2; Azure-generated hostname, no linked Functions API or Monotorr app |
| `monotorr-cw-db-01` | New group | PostgreSQL 18 flexible server in **North Central US**, dedicated database boundary |
| `connectwise` | New PostgreSQL server | Create dedicated product database |
| `cw-deploy-identity` | New group | User-assigned deployment identity with GitHub environment-scoped federation |
| `connectwise-migrate` | New group | Manual Container Apps job, shared control image, separate system identity and migration DB role |
| `connectwise-bootstrap` | New group, temporary | Explicit operator-only job, distinct system identity, no retries, 180-second execution limit; delete after bootstrap or failure |
| Existing MCP app/environment/ACR/vault/pull identity | Existing group | Preserve and reuse; no move, recreation, MCP image change, revision-mode change, traffic change, or probe change |
| New database private endpoint/NIC | New group where possible | `pe-connectwise-prod-postgres` on existing `snet-monotorr-private-endpoints` (`10.42.0.32/28`); allocate a new IP, preserve `10.42.0.36` |
| Existing PostgreSQL private DNS zone | Existing group | Add a zone group for the new private endpoint; do not change existing Monotorr records/links |

The candidate server name must pass Azure availability checks before creation. Approved intentional launch-size SKU: Burstable `Standard_B1ms` (1 vCPU/2 GiB RAM), 32 GiB Premium SSD storage with autogrow, 14-day PITR backups, PostgreSQL 18, no HA and no geo-redundant backup initially. Only the PostgreSQL server is placed in North Central US; the control API, migration/bootstrap jobs, deployment identity and private endpoint remain East US. This is a small dedicated production-shaped boundary, not a capacity/SLA guarantee. Review actual region availability and Azure cost estimate before creation. Do not move to the existing Monotorr B1ms database to avoid this decision.

Reuse the existing shared environment, registry, approved network and logging as infrastructure only. Separate applications, runtime identities, database/roles, secrets and configuration remain mandatory. Existing ACR has `LegacyRegistryPermissions`; it is not repository-scoped ABAC. Proposed `AcrPush` is registry-wide. The scripts hard-pin the ConnectWise control repository, but that is not an Azure IAM boundary. Registry-scoped `AcrPush` for the dedicated repository/workflow OIDC identity is an explicitly accepted V1 infrastructure constraint. No ABAC migration is authorized in Phase 0. Existing `connectwise-mcp-pull-id` and `monotorr-api-prod-pull-id` AcrPull assignments remain unchanged; do not use registry admin credentials or grant subscription Owner.

## Commands/actions for operator review before any live change

Run from the canonical repository only. These are future actions, NOT instructions to execute before repository review and live-action approval. Do not use shell tracing/debug flags. No password/token values belong in argv or shell history.

```sh
az group create --name monotorr-connectwise-prod-rg --location eastus --output none
az identity create --name cw-deploy-identity --resource-group monotorr-connectwise-prod-rg --location eastus --output none
az identity federated-credential create --name github-connectwise-production --identity-name cw-deploy-identity --resource-group monotorr-connectwise-prod-rg --issuer https://token.actions.githubusercontent.com --subject repo:robleon-git@202705822/connectwise-mcp@1404568890:environment:connectwise-production --audiences api://AzureADTokenExchange --output none
az staticwebapp create --name connectwise-portal --resource-group monotorr-connectwise-prod-rg --location eastus2 --sku Standard --output none
```

Database creation is an Azure portal action to avoid putting the bootstrap administrator password in a CLI argument. Select **North Central US** for the server and use the approved SKU/database settings above; administrator `cw_bootstrap_admin`; create/store its strong password securely as `cw-bootstrap-db-password` in `cw-mcp-kv`. Do not display/copy it through diagnostic commands. Use private endpoint networking to the approved existing VNet with correct private DNS; leave public access disabled with no public firewall allowances; verify connectivity from the private job. Do not add `0.0.0.0` Azure-wide firewall access or weaken TLS. Record exact approved subnet/private endpoint IDs before performing this networking action.

After server creation:

```sh
az postgres flexible-server db create --resource-group monotorr-connectwise-prod-rg --server-name monotorr-cw-db-01 --name connectwise --output none
```

Database bootstrap now runs as the temporary `connectwise-bootstrap` job inside the existing ACA environment. No laptop or GitHub-hosted runner connects to PostgreSQL. The bootstrap runner is compiled into the reviewed control image as `dist/database/bootstrap-cli.js`; API startup and the normal migrator never invoke it. `scripts/deploy/bootstrap-database.mjs` is management-plane orchestration only and receives no passwords.

The two service-secret names must initially contain the NONSECRET marker `__CW_DATABASE_BOOTSTRAP_PENDING__`. This allows secret-specific role assignments before bootstrap, without granting vault-wide write access. Bootstrap refuses absent placeholders, existing role/password state, overlapping bootstrap execution, unsafe target configuration, or a non-admin database session. It generates distinct passwords in memory, replaces only those two placeholders, and grants separate non-superuser/non-CREATEROLE roles. Temporary migrator SET/INHERIT privileges used for default SELECT privileges are revoked within the SQL transaction. PostgreSQL 18 may retain the creator administrator’s automatic ADMIN-only membership; that is part of the infrastructure administrator’s role-management authority, not permission granted to a running application.

The bootstrap password secret belongs only to the temporary job. Successful bootstrap is not complete until its three temporary assignments are removed, the bootstrap secret is disabled, and the temporary job is deleted. The operator helper attempts this cleanup on success, failure, timeout, or preflight rejection. Cleanup failure is nonzero `bootstrap_cleanup_required`, never success. A killed operator process requires immediate manual cleanup using the recorded nonsecret principal/assignment IDs; use `cleanup` while the job exists or the explicit cleanup commands below after deletion. The Azure server administrator remains an infrastructure break-glass account, not an application service; no runtime/migration identity receives its credential or administrator role membership.

Vault writes and SQL are not one transaction. A partial write or rolled-back SQL bootstrap requires operator reconciliation of these two NEW service secrets/roles before a separately reviewed retry. Do not overwrite real service credentials or reset customer ConnectWise keys. A crashed job cannot be safely auto-retried: the job has retry limit zero. The 180-second job bound and 30-second statement timeouts contain execution; the operator polls at most 24 times at 10-second intervals.

The migration runner creates only `public.schema_migrations` and records `0001_delivery_foundation`; the initial migration is `SELECT 1`. Future account schema belongs to Phase 1. Runtime gets ledger SELECT through migrator default privileges; no runtime DDL/ledger writes. Bootstrap later grants are product-only, not grants on Monotorr's server.

Initial image publication uses the manually dispatched `build` action after repository review/commit. Its stdout/artifact contains the immutable control image digest, not credentials. The deployment workflow is OIDC-authenticated. The local `release:phase0` command assumes an already approved Azure login with the same scoped permissions; it does not implement a static Azure login fallback.

Before creating API/job, fill the immutable image reference from that reviewed build and approve the following templates. The environment/pull-identity IDs intentionally reference existing resources; no resource is moved.

```sh
node scripts/deploy/render-resources.mjs 'monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:<reviewed-digest>'
# Review all three JSON files before live PUT actions; bootstrap is temporary. They contain references, never passwords.
CW_APP_ID='/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.App/containerApps/connectwise-control-api'
CW_JOB_ID='/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg/providers/Microsoft.App/jobs/connectwise-migrate'
az rest --method put --url "$CW_APP_ID?api-version=2025-07-01" --body @.delivery/api.json --output none
az rest --method put --url "$CW_JOB_ID?api-version=2025-07-01" --body @.delivery/job.json --output none
```

The rendered NEW API has all startup/liveness/readiness probes in its first template, multiple-revision mode and HTTPS-only ingress. Its new system identity becomes available while readiness is pending; grant scoped RBAC, execute the first migration, then require readiness before claiming deployment success. The new job is manual-only and runs `node dist/database/cli.js` from the same reviewed image. These resource manifests must never be applied to the existing MCP app.

The renderer includes HTTPS-only ingress and the explicit startup/liveness `/health` and readiness `/ready` probe fragment in `deployment/azure/control-probes.json` in the NEW API initial template. Startup: 5 s interval/2 s timeout/30 failures; liveness: 10 s/2 s/3; readiness: 10 s/10 s/3 (bounded DB/Vault readiness). No customer configuration is queried. The API can be live while initially not-ready until role/RBAC/migration setup completes. Creation/reconciliation must tolerate this bootstrap order and cannot promote a not-ready revision.

RBAC actions, after reviewing actual principal IDs:

```sh
CW_KV_ID=$(az keyvault show --name cw-mcp-kv --resource-group monotorr-dev-eastus-rg --query id -o tsv)
CW_API_PRINCIPAL=$(az containerapp show --name connectwise-control-api --resource-group monotorr-connectwise-prod-rg --query identity.principalId -o tsv)
CW_MIGRATOR_PRINCIPAL=$(az containerapp job show --name connectwise-migrate --resource-group monotorr-connectwise-prod-rg --query identity.principalId -o tsv)
az role assignment create --assignee-object-id "$CW_API_PRINCIPAL" --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets User' --scope "$CW_KV_ID/secrets/cw-control-db-password" --output none
az role assignment create --assignee-object-id "$CW_MIGRATOR_PRINCIPAL" --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets User' --scope "$CW_KV_ID/secrets/cw-migration-db-password" --output none
```

Neither identity receives customer CW-key read access, Monotorr application secrets, or role-assignment permissions in Phase 0. Existing MCP permissions stay unchanged.

For `cw-deploy-identity`, grant only: Contributor scoped to the NEW API and migration job; optional Reader scoped to the existing MCP app for read-only baseline capture; Reader scoped to the shared environment if required by the deployment operation; `AcrPush` scoped only to `monotorrdevacr6689`; and a custom role scoped to the new SWA with `Microsoft.Web/staticSites/read` and `Microsoft.Web/staticSites/listSecrets/action`. No vault data-plane access, DB credentials, subscription Owner, or automatic IAM provisioning. An authorized infrastructure operator performs resource creation/role assignments separately.

Keep GitHub environment `connectwise-production` with no required reviewers, only the approved `phase1-hardening` deployment branch, `can_admins_bypass=false`, and variable `CW_AZURE_DEPLOY_CLIENT_ID` set to the deployment identity's nonsecret client ID. Workflows are manual only. Tests/builds/audits run in a job WITHOUT production environment access or OIDC issuance permissions. Only after those gates pass does the protected delivery job receive OIDC permissions; it reuses verified portal assets and does not execute npm build scripts with deployment credentials. Static Web Apps' official deploy action still requires its transport token; the workflow obtains it through OIDC-authenticated ARM, masks it immediately, and passes it directly to the action. It is not stored as a long-lived GitHub secret or artifact and is not printed. This Azure transport token is not product user authentication. Built-in SWA login routes are blocked in the Phase 0 portal.

## Human approval in Codex

Before every live-changing workflow action or rerun, Codex presents the exact action, source SHA, target resources, immutable image/artifact evidence where applicable, expected changes, smoke checks and rollback plan. The owner explicitly approves in Codex; only then does Codex dispatch the manual workflow. A changed action/source/target requires fresh approval. There is no additional GitHub reviewer click and no automatic deployment on push.

The delivery job permits only `workflow_dispatch` in `robleon-git/connectwise-mcp`, `refs/heads/phase1-hardening`, with both initiating actor and rerun actor `robleon-git`. Keep the environment branch restriction and existing exact immutable OIDC repository/environment subject, issuer/audience and scoped Azure roles unchanged. Build/test/lint/production-audit/full-audit gates run before the delivery job. Keep concurrency, immutable digest/source checks, retained evidence, smoke and rollback safeguards. No Phase 0 MCP deployment is permitted.

Codex approval is an operator process gate, not a GitHub-verifiable approval claim. The same owner can still manually dispatch through GitHub UI/CLI; doing so must follow this approval process. No collaborator permissions, additional operators or authentication protocol are introduced. Future changes to production operators require explicit review. Historical GitHub-review records in the live status document describe the former process, not current requirements.

## Release process and environment contract

Promotion/rollback reads the selected revision's active state. Already-active revisions skip activation; inactive revisions must activate successfully before traffic changes. Unknown active state fails closed. Traffic rejection aborts; ambiguous timeouts require read-only confirmation of actual traffic before any further action. The live acceptance exercise promoted, rolled back and restored the existing candidate without changing either image, revision mode or database state.

Nonsecret resource targets: `deployment/azure/config.json` (allowlisted by the scripts). Azure-generated API/SWA hostnames are discovered from the named resources. Permanent names must be chosen before Phase 1 session/callback settings. No frontend API key or customer secret is configured. `CW_CUSTOMER_FEATURES_ENABLED` must be false; attempting to enable it fails API startup. Unknown/product/MCP routes are 404 even if called directly.

API service settings: `CW_DB_HOST`, `CW_DB_NAME=connectwise`, `CW_DB_USER=cw_control`, `CW_DB_PASSWORD_SECRET=cw-control-db-password`, `CW_KEY_VAULT_URI`, `CW_CONTROL_PORT=8080`, `NODE_ENV=production`. Migrator uses its distinct DB user and secret. Production permits only the Azure TLS configuration; local loopback integration mode cannot be enabled in production.

Manual workflow actions:

1. `build`: run full gates, build/push a control image tagged with the full source SHA, capture immutable digest in protected evidence. Creates no app or database.
2. First infrastructure bootstrap: operator performs the approved actions above using that digest. The migration job must succeed before API readiness is expected. No working MCP mutation occurs.
3. Set `CW_BUILT_RUN_ID` to the reviewed build run at the same source SHA. `prepare`: retest source and download/reuse its already-built immutable artifact (never rebuild/repoint the SHA tag), retain NEW API traffic on its previous ready revision, persist rollback evidence, run manual migration job with the new image, then deploy/smoke a candidate on the new API only. There is no auto-promotion.
4. Set `CW_PREPARED_RUN_ID` to the reviewed successful prepare run ID; `promote` downloads its evidence, validates source/image, and switches NEW API traffic after candidate smoke. A change affecting MCP authorization/execution requires a separate MCP release review/manual owner QA, never a bypass flag in this Phase 0 script.
5. `rollback`: use the reviewed release evidence to select the previous API image/revision, then repeat deployed smoke. It does not roll back database state or secrets.
6. `portal`: deploy tested prebuilt portal assets and smoke the Azure-generated hostname. To roll back portal assets, manually dispatch the reviewed prior source revision and rebuild its locked dependencies; no runtime customer data exists in this shell.

At every applicable action, CI runs existing regressions plus portal typecheck/build and real disposable PostgreSQL integration tests. It never resets the Azure database. The local release build refuses a dirty/unreviewed source tree. Source changes since the prior deployed SHA, not only the last commit, are used for MCP-impact detection. Logs/artifacts contain only statuses, source/image/revision identifiers, migration IDs, and safe URLs.

Run non-authenticated baseline verification with:

```sh
npm run smoke:delivery -- mcp https://api.monotorr.com
```

This runs health/metadata/anonymous-401 checks only. It loads no customer keys and makes no ConnectWise request. It does not prove authenticated discovery or the owner dogfood journey.

Both CI and manual release verification require full `npm audit` and `npm run validate:ticket-card`. The inherited `vite-plugin-singlefile` → `micromatch` → `braces` chain is removed without a framework downgrade or advisory exception. The narrow build step emits only self-contained ticket-card HTML; the generated module is byte-for-byte unchanged.

Database integration locally: use a disposable PostgreSQL 18 container bound to `127.0.0.1`, database `cw_delivery_test`, and a SYNTHETIC local-only password. Set `CW_DATABASE_INTEGRATION=true`, `CW_DB_HOST=127.0.0.1`, `CW_DB_PORT`, `CW_DB_NAME=cw_delivery_test`, `CW_DB_USER=postgres`, and `CW_DB_LOCAL_PASSWORD` for `npm run test:database`. The tests refuse an Azure/non-disposable target and also create/drop a separate `connectwise` test database and bootstrap/runtime/migrator roles inside that disposable container. Never point these tests at a shared local database. Remove the container afterward. Committed CI passwords are explicitly synthetic and exist only in the ephemeral CI container.

## Rollback and completion limits

MCP revision mode, traffic, probes, images and configuration are NOT managed by the Phase 0 release workflow. No DNS/custom-domain/Descope/ConnectWise changes are authorized here. Candidate labels/revisions apply only to the NEW control API. Existing MCP health/protocol behavior is tested, not replaced.

Do not restore customer entitlement/secret/connection state during rollback. Readiness requires the current image's known migration checksums but tolerates additional additive migrations so older compatible API revisions can remain healthy. Migrations validate full immutable history before application. Destructive compatibility changes need separate review.

Phase 0 remains incomplete until actual infrastructure approval, Azure bootstrap, deployed API/portal/database checks, authorized authenticated MCP smoke, and a NEW API rollback rehearsal succeed. Current repository validation cannot claim those future gates passed. There is no Phase 1 signup/account/identity/entitlement/customer-connection/admin/billing functionality in this change.

Sources: [Container Apps probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes), [jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [revisions/configuration scope](https://learn.microsoft.com/en-us/azure/container-apps/revisions), [SWA deploy action inputs](https://raw.githubusercontent.com/Azure/static-web-apps-deploy/v1/action.yml), [SWA tokens](https://learn.microsoft.com/en-us/azure/static-web-apps/deployment-token-management).


## Full dependency audit release gate

The inherited ticket-card plugin dependency chain has been removed and the reviewed checkpoint CI passed both production and full dependency audits. Both remain mandatory release gates; no audit exception or force-fix is authorized. This historical blocker is resolved, not a reason to bypass subsequent audits.

## Exact private networking and bootstrap actions — future operator execution only

These actions require separate live-resource approval. No commands in this section were executed during repository preparation. Run from the canonical repository without shell tracing. All password entry is through secure Azure portal forms; do not put passwords in arguments, environment files, artifacts, or GitHub.

1. Create the dedicated resource group, deployment identity/federation and portal using the commands above. Confirm the proposed PostgreSQL name/SKU/region availability and cost; create the dedicated PostgreSQL 18 server in **North Central US**, in the new group through the portal with administrator `cw_bootstrap_admin`, public access disabled and no public firewall allowances. Securely create `cw-bootstrap-db-password` in `cw-mcp-kv` through the portal; never retrieve it with an operator CLI. Create the `connectwise` database via ARM as shown above.
2. Attach a new private endpoint to the existing nondelegated private-endpoint subnet. Reuse the existing DNS zone/link without changing existing records. No new VNet, gateway, peering, VPN or database delegation is required.

```sh
CW_SUBSCRIPTION='08a97e42-1e1f-4f33-95dc-36af13337091'
CW_NEW_RG='monotorr-connectwise-prod-rg'
CW_SHARED_RG='monotorr-dev-eastus-rg'
CW_PG_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_NEW_RG/providers/Microsoft.DBforPostgreSQL/flexibleServers/monotorr-cw-db-01"
CW_SUBNET_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.Network/virtualNetworks/monotorr-prod-vnet/subnets/snet-monotorr-private-endpoints"
CW_DNS_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.Network/privateDnsZones/privatelink.postgres.database.azure.com"
az network private-endpoint create --name pe-connectwise-prod-postgres --resource-group "$CW_NEW_RG" --location eastus --subnet "$CW_SUBNET_ID" --private-connection-resource-id "$CW_PG_ID" --group-id postgresqlServer --connection-name connectwise-postgres --output none
az network private-endpoint dns-zone-group create --resource-group "$CW_NEW_RG" --endpoint-name pe-connectwise-prod-postgres --name default --private-dns-zone "$CW_DNS_ID" --zone-name postgres --output none
az postgres flexible-server update --resource-group "$CW_NEW_RG" --name monotorr-cw-db-01 --public-access Disabled --output none
```

Private DNS must resolve `monotorr-cw-db-01.postgres.database.azure.com` to the new endpoint from ACA. Connections use this canonical name with certificate verification on TCP 5432. A private endpoint does not independently isolate other workloads in the shared VNet; separate database roles, Vault RBAC and product identities remain the credential/access boundary. The existing private-endpoint subnet has network policies disabled; this plan does not change its shared policy or existing endpoint.

3. Grant the dedicated OIDC identity the accepted registry role, then manually dispatch the gated `build` workflow after review/commit. No secrets or database access are given to that identity. Do not dispatch a build before repository review or use a local bypass of audit gates.

```sh
CW_ACR_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.ContainerRegistry/registries/monotorrdevacr6689"
CW_DEPLOY_PRINCIPAL=$(az identity show --resource-group "$CW_NEW_RG" --name cw-deploy-identity --query principalId -o tsv)
az role assignment create --assignee-object-id "$CW_DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal --role AcrPush --scope "$CW_ACR_ID" --output none
```

4. Render/review `api.json`, `job.json` and `bootstrap.json` with that immutable digest using the existing renderer command. Create the new API/migration job using the earlier PUT commands and the temporary job as follows. None of these manifests target the existing MCP app. GitHub gets no permissions on the bootstrap job or its identity.

```sh
CW_BOOT_JOB_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_NEW_RG/providers/Microsoft.App/jobs/connectwise-bootstrap"
az rest --method put --url "$CW_BOOT_JOB_ID?api-version=2025-07-01" --body @.delivery/bootstrap.json --output none
CW_BOOT_PRINCIPAL=$(az containerapp job show --resource-group "$CW_NEW_RG" --name connectwise-bootstrap --query identity.principalId -o tsv)
CW_KV_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.KeyVault/vaults/cw-mcp-kv"
```

5. Check only secret-name metadata and stop unless BOTH new service secrets are absent. Never use these placeholder commands against an existing configured database/service.

```sh
CW_EXISTING_SERVICE_SECRETS=$(az keyvault secret list --vault-name cw-mcp-kv --query "length([?name=='cw-control-db-password' || name=='cw-migration-db-password'])" -o tsv)
test "$CW_EXISTING_SERVICE_SECRETS" = 0 || exit 1
az keyvault secret set --vault-name cw-mcp-kv --name cw-control-db-password --value __CW_DATABASE_BOOTSTRAP_PENDING__ --output none
az keyvault secret set --vault-name cw-mcp-kv --name cw-migration-db-password --value __CW_DATABASE_BOOTSTRAP_PENDING__ --output none
CW_BOOT_READ_ASSIGNMENT=$(az role assignment create --assignee-object-id "$CW_BOOT_PRINCIPAL" --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets User' --scope "$CW_KV_ID/secrets/cw-bootstrap-db-password" --query id -o tsv)
CW_BOOT_CONTROL_ASSIGNMENT=$(az role assignment create --assignee-object-id "$CW_BOOT_PRINCIPAL" --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets Officer' --scope "$CW_KV_ID/secrets/cw-control-db-password" --query id -o tsv)
CW_BOOT_MIGRATION_ASSIGNMENT=$(az role assignment create --assignee-object-id "$CW_BOOT_PRINCIPAL" --assignee-principal-type ServicePrincipal --role 'Key Vault Secrets Officer' --scope "$CW_KV_ID/secrets/cw-migration-db-password" --query id -o tsv)
```

Record these nonsecret principal/assignment IDs for recovery before running the helper. These assignments are temporary and secret-scoped. No vault-wide Secrets Officer/Administrator fallback is allowed. Verify RBAC propagation before invocation; a failed attempt has no automatic retry. Individual-secret RBAC is supported by [Microsoft's Key Vault guidance](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide).

6. Invoke the bounded helper explicitly:

```sh
npm run bootstrap:database -- run
```

Expected successful output is only:

```json
{"databaseBootstrapSucceeded":true,"bootstrapPermissionsRemoved":true,"bootstrapJobDeleted":true}
```

It starts/polls Azure management-plane execution, reads no DB passwords, removes its reviewed assignments, disables the bootstrap password secret and deletes the job. GitHub never runs this operation. The runtime and migration jobs have separate system identities; shared user-assigned image-pull identity has no database/Vault administration privileges.

7. If operator interruption or cleanup failure occurs, perform the following authorized cleanup even when SQL has failed. Do not treat the setup as PASS until all cleanup is verified. While the job exists, `npm run bootstrap:database -- cleanup` attempts cleanup without starting execution. If already deleted, use the recorded IDs:

```sh
az role assignment delete --ids "$CW_BOOT_READ_ASSIGNMENT" "$CW_BOOT_CONTROL_ASSIGNMENT" "$CW_BOOT_MIGRATION_ASSIGNMENT" --output none
az keyvault secret set-attributes --vault-name cw-mcp-kv --name cw-bootstrap-db-password --enabled false --output none
# Only if it still exists:
az containerapp job delete --resource-group "$CW_NEW_RG" --name connectwise-bootstrap --yes --output none
az role assignment list --all --fill-principal-name false --query "[?principalId=='$CW_BOOT_PRINCIPAL'].{id:id,scope:scope}" -o json
# Must return []; verify job absence and bootstrap secret disabled through portal metadata.
```

8. Grant API/migrator their separate secret-read scopes using the earlier commands. Grant OIDC Contributor only on the new API and migration job, necessary Reader on the shared environment, and the described narrowly scoped SWA transport-token role. If updates require `Microsoft.ManagedIdentity/userAssignedIdentities/assign/action`, authorize that permission only on the existing ConnectWise pull identity; never change its AcrPull assignment. No OIDC RBAC administration, Vault data-plane, PostgreSQL login, bootstrap-job access or subscription Owner.
9. Start `connectwise-migrate` through Azure management plane and poll success; require API health/readiness, gated product routes and portal smoke success. Exercise new API revision rollback. Refresh existing MCP anonymous smoke and perform applicable owner dogfood QA. Rollback never reverses secrets/schema. A PostgreSQL disaster recovery uses PITR to a separate server and reviewed private endpoint/DNS/configuration changes, not an automatic down migration.

Permanent operator SQL access is intentionally absent. Emergency SQL requires a separately reviewed one-off job/identity on this private network, followed by the same privilege cleanup discipline; do not reopen public firewall access or give the standard migrator administrator privileges.

### Exact scoped OIDC application permissions — future actions only

Create this reviewed custom role definition and assign all deployment roles only after the named new resources exist. `CW_DEPLOY_PRINCIPAL`, `CW_APP_ID`, `CW_JOB_ID`, `CW_SUBSCRIPTION`, `CW_SHARED_RG` and `CW_NEW_RG` refer to the nonsecret IDs above. The deployment identity does not create resources or assign roles itself.

```sh
az role assignment create --assignee-object-id "$CW_DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal --role Contributor --scope "$CW_APP_ID" --output none
az role assignment create --assignee-object-id "$CW_DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal --role Contributor --scope "$CW_JOB_ID" --output none
CW_ENV_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.App/managedEnvironments/monotorr-prod-aca-env"
az role assignment create --assignee-object-id "$CW_DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal --role Reader --scope "$CW_ENV_ID" --output none
az role definition create --role-definition @deployment/azure/portal-deploy-role.json --output none
CW_SWA_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_NEW_RG/providers/Microsoft.Web/staticSites/connectwise-portal"
az role assignment create --assignee-object-id "$CW_DEPLOY_PRINCIPAL" --assignee-principal-type ServicePrincipal --role 'ConnectWise Portal Deployment Token' --scope "$CW_SWA_ID" --output none
```

The local baseline command runs with the operator's Azure login. Only if baseline capture is incorporated into delivery later, separately approve Reader on the existing MCP resource. It is not needed by the present workflow. The present image update path does not replace the user-assigned identity; do not preemptively grant additional identity-management rights. Any Azure-reported assign-action requirement must be reviewed at the exact existing pull-identity scope before adding it.


## Approved North Central US database placement — repository baseline, 2026-10-10

This section supersedes any earlier East US database proposal. The owner approved North Central US and server name `monotorr-cw-db-01`, retaining Burstable Standard_B1ms as the intentional initial V1 size, accepting the approximate $23.39/month fixed database infrastructure cost, Burstable limitations, and cross-region latency/usage-based bandwidth tradeoffs. Do not request an East US exception or use the shared Monotorr PostgreSQL server. Initial group/deployment identity/federation/portal shell have been created under final owner approval; database/application deployment and live acceptance are complete; see the live status record.

### Exact resource inventory and estimated recurring costs

All new resources use `monotorr-connectwise-prod-rg` unless otherwise stated. USD PAYG estimates use 730 hours/month and current public retail prices; they are not a whole-product quote. Taxes, discounts, excess backup storage, storage growth, shared logging, traffic and transaction charges are additional.

| Name/resource | Resource group | Region | SKU/configuration | Estimated recurring cost | Identity/access implications |
| --- | --- | --- | --- | --- | --- |
| `monotorr-connectwise-prod-rg` | Self | East US metadata | Resource group | $0 | Infrastructure operator creates it; no subscription Owner grant to deployment identity |
| `monotorr-cw-db-01` | New group | **North Central US** | PostgreSQL 18; Burstable `Standard_B1ms`; 1 vCPU/2 GiB; 32 GiB Premium SSD (`ManagedDisk`)/autogrow; 14-day PITR; HA Disabled; geo-backup Disabled; public access Disabled | **$16.09/month**: $0.017/hour compute ($12.41) + 32 × $0.115/GB-month storage ($3.68) | Infrastructure administrator `cw_bootstrap_admin`; separate constrained runtime and migration DB roles; no application administrator privilege |
| `connectwise` | New server in new group | North Central US | Dedicated database | Included in server | `cw_control`: runtime role; `cw_migrator`: migration role; bootstrap creates them privately |
| `pe-connectwise-prod-postgres` + Azure-generated NIC | New group | **East US** | Private endpoint, group `postgresqlServer`; existing subnet `snet-monotorr-private-endpoints` | **$7.30/month** endpoint + usage | Operator needs endpoint creation, subnet join and connection approval permissions; no subnet policy modification |
| `default` DNS zone group + new server A record | Endpoint in new group; record in existing zone in `monotorr-dev-eastus-rg` | East US endpoint; DNS global | Existing `privatelink.postgres.database.azure.com` and existing VNet link | No new zone fixed charge; existing DNS usage applies | Operator links endpoint to zone; only new server record added, no existing record/link replacement |
| `cw-deploy-identity` + `github-connectwise-production` federation | New group | East US | User-assigned identity; GitHub protected environment subject | No identity fixed charge | Registry-scoped AcrPush; new API/job Contributor; shared environment Reader; portal-specific token role only if portal approved; no DB passwords/Vault data-plane/RBAC administration |
| `connectwise-control-api` | New group | **East US** | ACA Consumption, 0.5 vCPU/1 GiB, one minimum/maximum replica; Multiple revisions; initial health-only image | Approx. **$11.83/month fully idle to $39.42/month fully active**, before subscription free allowances, requests/logging; candidate overlap can add cost | New system identity reads only `cw-control-db-password`; existing ConnectWise pull identity reused unchanged |
| `connectwise-migrate` | New group | **East US** | Manual ACA job; 0.5 vCPU/1 GiB, retry 0, timeout 180 s | Execution-based; approx. $0.0027 for 180 s compute, plus logs | Separate system identity reads only `cw-migration-db-password`; no role creation/admin privilege |
| `connectwise-bootstrap` | New group; temporary | **East US** | Explicit operator-only ACA job; same sizing/bounds; deleted after use | Execution-based, same compute rate; no idle service | Distinct system identity with three temporary secret-scoped grants; cleanup removes grants, disables bootstrap secret, deletes job |
| `cw-bootstrap-db-password`, `cw-control-db-password`, `cw-migration-db-password` | Existing `cw-mcp-kv`, shared group | East US | Three new product DB secrets | Existing vault transaction charges; no new vault | Bootstrap administrator secret entered through secure portal; service passwords generated in job memory; no customer key changes |
| `connectwise-portal` | New group | **East US 2 (explicitly approved)** | Previously approved Standard SWA; globally distributed assets; no managed Functions | $9/month if Standard SWA retained, plus excess bandwidth | No customer keys or DB access; dedicated SWA transport-token role; placement explicitly approved; published shell and deployed smoke passed |

Subscription metadata was checked read-only with:

```sh
az provider show --namespace Microsoft.Web --query "resourceTypes[?resourceType=='staticSites'].locations" --output json
```

It returned Central US, East US 2, West US 2, West Europe and East Asia, not East US. The owner explicitly resolved portal placement to **Standard Static Web Apps in East US 2**. Static assets are globally distributed; no managed Functions API is added. The control API and ACA jobs remain East US. [Microsoft SWA region semantics](https://learn.microsoft.com/en-us/azure/static-web-apps/faq#how-do-i-ensure-my-app-is-deployed-to-a-specific-azure-region).

The PG + endpoint fixed estimate is **$23.39/month**. Private Link data processing starts at $0.01/GB; North America inter-region transfer is listed at $0.02/GB for applicable billable traffic. Published East US → North Central US backbone median RTT is approximately 19 ms; this is not an application latency guarantee. This cost/latency tradeoff is explicitly accepted. [PostgreSQL pricing](https://azure.microsoft.com/en-us/pricing/details/postgresql/flexible-server/), [Private Link pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/), [bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/), [ACA pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [SWA pricing](https://azure.microsoft.com/en-us/pricing/details/app-service/static/).

### Exact next actions — approval required before execution

1. Read-only subscription/tenant/name/SKU verification, then the existing `az group create`, `az identity create` and federation commands above. Keep group and identity location `eastus`. Confirm no resources with these new names already exist; reconcile rather than overwrite if they do.

```sh
az account show --query '{subscription:id,tenant:tenantId}' --output json
az postgres flexible-server list-skus --location northcentralus --output json
az rest --method post --url 'https://management.azure.com/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/providers/Microsoft.DBforPostgreSQL/checkNameAvailability?api-version=2024-08-01' --body '{"name":"monotorr-cw-db-01","type":"Microsoft.DBforPostgreSQL/flexibleServers"}' --output json
```

2. **Azure Portal action**, not a password-bearing CLI command: create `monotorr-cw-db-01` in `monotorr-connectwise-prod-rg`, **North Central US**, with every server setting in the inventory table. Choose the Private Link-compatible networking model (not delegated-subnet VNet integration); public network access must be Disabled, no firewall rules. Enter a strong administrator password only through the secure portal and save it as `cw-bootstrap-db-password` in the existing Key Vault through its secure secret-entry form. Never retrieve that password through operator/GitHub CLI. Verify ARM settings before continuing: `location=northcentralus`, `sku.name=Standard_B1ms`, `sku.tier=Burstable`, `version=18`, `storage.storageSizeGB=32`, Premium SSD/ManagedDisk selected, `storage.autoGrow=Enabled`, `backup.backupRetentionDays=14`, `backup.geoRedundantBackup=Disabled`, `highAvailability.mode=Disabled`, `network.publicNetworkAccess=Disabled`. Stop if any differ.

```sh
az postgres flexible-server show --resource-group monotorr-connectwise-prod-rg --name monotorr-cw-db-01 --query '{location:location,sku:sku,version:version,storage:storage,backup:backup,highAvailability:highAvailability,network:network}' --output json
az postgres flexible-server db create --resource-group monotorr-connectwise-prod-rg --server-name monotorr-cw-db-01 --name connectwise --output none
```

3. Run the exact private endpoint and DNS-zone-group commands in the private networking section above, **both retaining `--location eastus` where applicable**. The subnet and private DNS IDs remain in `monotorr-dev-eastus-rg`. A private endpoint in East US can reach the PostgreSQL server in North Central US; no new VNet, peering, VPN, gateway, DNS zone or DNS VNet link is created. Verify the new server FQDN resolves to its new endpoint from the private job, and existing DNS records/IP `10.42.0.36` are unchanged. [PostgreSQL cross-region Private Link](https://learn.microsoft.com/en-us/azure/postgresql/network/concepts-networking-private-link).

4. The existing registry-scoped AcrPush assignment command applies only to the new deployment identity. Provision GitHub environment `connectwise-production`, no required reviewers, approved `phase1-hardening` deployment branch, and nonsecret `CW_AZURE_DEPLOY_CLIENT_ID`. No dispatch/build/push/deployment is authorized by this documentation update. After separate deployment approval, dispatch `.github/workflows/deploy.yml` action `build` at the reviewed source SHA, obtain the reviewed immutable digest, and render the existing API/migrate/bootstrap manifests. Keep `deployment/azure/config.json` `location=eastus`: it controls application/job locations, not portal-assisted server creation. No script currently provisions PostgreSQL, so no new config key or code change is needed for the database-region decision.

5. After separate deployment approval, execute the existing new-resource ARM PUT commands, placeholder checks, temporary bootstrap RBAC assignments, bounded bootstrap helper/cleanup, permanent service-secret read grants and exact OIDC application permissions above. Run the normal migration through Azure management plane, then API readiness, revision/rollback smoke and existing MCP read-only baseline. GitHub never connects to PostgreSQL or receives DB passwords. Portal placement is approved in East US 2; publication follows the normal protected workflow and smoke gates.

### Protection and rollback boundary

These actions do not modify the existing MCP Container App, its image/configuration/identity/revision mode/traffic/probes, MCP routing, public DNS/custom-domain bindings serving `api.monotorr.com`, existing Monotorr PostgreSQL servers/databases, or either existing AcrPull assignment. The only shared-resource writes are three NEW product DB secrets and scoped grants in `cw-mcp-kv`, the new PostgreSQL private DNS record/zone-group association, attachment of a NEW endpoint/NIC to the existing subnet, and NEW deployment-identity assignments at the shared ACR/environment scopes. A later approved image publication writes only `connectwise-control-api` in the shared ACR.

Database cross-region placement does not change customer MCP auth, Descope, ConnectWise credentials or tool registration. Keep 39 reads/0 writes. Incomplete product routes remain closed; no Phase 1 functionality is started. Pre-application failure cleanup removes only new resources/records/grants after operator review; preserve every pre-existing shared resource. Once DB bootstrap/data exist, retain the database/secrets and use the documented recovery/rollback procedure rather than blindly deleting the resource group. PITR creates a separately reviewed replacement server/endpoint; it is not an automatic failover or down migration.

**Final owner approval received for the documented Phase 0 resource creation/deployment sequence, including East US 2 portal placement. Preserve all hard constraints and stop conditions. Secure database/password Portal entry remains a manual operator step; do not bypass it with secrets in CLI/files.**


## B1ms launch operations and monitoring — deployed native alerts

Authority: owner-approved initial V1 database size. The database holds control-plane users/accounts/memberships/external identities/entitlements/connection metadata/onboarding/Stripe references/audit events only. Do not persist ConnectWise operational ticket/company/time/invoice/project datasets. The 39 MCP tools continue to query ConnectWise directly. No application, tenant/data architecture or credential-resolution change is required by this size decision.

Cost authority: [Phase 0 cost baseline](PHASE0_COST_BASELINE.md). The General Purpose launch-size proposal is superseded; it is only a future upgrade path. Dedicated server/database, private networking, separate runtime/migration roles, managed identities, Key Vault and fail-closed customer authorization remain mandatory.

### Connection budget already implemented

`src/database/pool.ts` already sets `max: 3` per runtime/migration process, a 5-second acquisition timeout and a 10-second idle timeout. `src/database/bootstrap-cli.ts` sets `max: 1` for the temporary bootstrap process. Preserve these small pools. The new API remains one replica normally; two revisions during candidate validation/promotion consume up to six API connections, plus up to three migrator connections. Do not scale replica counts or pool sizes without reviewing the combined budget. PostgreSQL B1ms defaults to 50 total/35 user connections; verify the deployed values rather than assuming all 50 are available. Never raise `max_connections` to hide saturation. Built-in Azure PgBouncer is not available on Burstable.

### Planned monitoring resources and operator actions

Create these only after final infrastructure approval, all in `monotorr-connectwise-prod-rg`, scoped solely to `monotorr-cw-db-01`. They are Azure Monitor global resources, not new application compute/network. A resource's global monitoring location does not relocate the East US applications.

- Action group `ag-connectwise-db-ops` (short name `cwdbops`): explicitly selected operator notification recipient entered in the Azure portal; no customer data or secret values in alert messages. No auto-remediation action/webhook.
- Metric alert `cw-pg-cpu-credits-low`: Minimum `cpu_credits_remaining` < 30, window 15 minutes, evaluation 5 minutes, severity 2.
- Metric alert `cw-pg-cpu-sustained`: Average `cpu_percent` > 20, window 30 minutes, evaluation 5 minutes, severity 2. This is a capacity-review signal around the B1ms baseline, not proof of credit exhaustion.
- Metric alert `cw-pg-memory-pressure`: Average `memory_percent` > 80, window 15 minutes, evaluation 5 minutes, severity 2.
- Metric alert `cw-pg-connection-saturation`: Maximum `active_connections` > 29, window 5 minutes, evaluation 1 minute, severity 2. This metric includes idle and internal connections; the initial threshold is conservative, not a literal user-capacity ratio. Chart active/idle connections and confirm which connections consume the 35 user slots during the smoke test.
- Metric alert `cw-pg-connection-failures`: Total `connections_failed` > 0, window 5 minutes, evaluation 1 minute, severity 2. Diagnose failures without dumping DB auth errors/connection strings.
- Metric alert `cw-pg-storage-pressure`: Average `storage_percent` > 75, window 15 minutes, evaluation 5 minutes, severity 2. Chart `storage_used` and provisioned capacity over time; review each autogrow event and its permanent cost increase. Storage can grow but cannot shrink.

Exact future actions: Azure Portal → new database → Metrics, verify each metric definition/aggregation is supported; Alerts → create the named rule with the parameters above and action group. If a named metric is absent, stop/review rather than substituting a metric silently. Verify receiver delivery with an action-group test and exercise alert handling without a production load/connection flood. No broad diagnostic setting exporting SQL text, parameters or raw DB logs is authorized. Azure metric-alert/action-group charges are additional to the fixed database estimate; confirm the alert-price estimate before creation.

**Query latency:** establish a baseline using a bounded `SELECT 1` timing from the East US private job path and the migration/readiness smoke. Record only operation label, duration, success/failure, and sample count, never SQL parameters, results, identities or credentials. A readiness HTTP duration includes Vault/network/application overhead and must not be labeled pure query latency. Continuous query latency monitoring needs low-overhead aggregate client-side query/acquisition timings (p50/p95/count/error counts) for the new control-plane operations; this is a delivery observability requirement to verify before V1 launch, not functionality already present in Phase 0. No latency instrumentation is implemented by this documentation update. Do not enable Query Store/Query Performance Insight to meet this requirement on B1ms; Microsoft warns of Burstable performance impact. Do not add a privileged permanent SQL monitoring service. Use an initial review trigger of p95 > 250 ms for a simple indexed control-plane lookup over 15 minutes, calibrated against real deployed measurements; no customer/query text in telemetry.

The native Azure metric rules plus latency baseline/continuous timing acceptance are required monitoring coverage, not evidence that monitoring has already been deployed. Record measured credit replenishment, idle CPU/memory, connection counts, safe query timing and storage usage after provisioning and during deployed smoke. Adjust these proposed thresholds against observed behavior; do not silently disable alerts to declare PASS.

### Accepted limits and first upgrade path

B1ms is 1 vCPU/2 GiB, uses CPU credits and has a 20% underlying CPU baseline. Microsoft discourages Burstable for production, excludes 24/7 support, and may not provide RCA. Credit exhaustion can cause severe latency or unreachability. HA and Azure built-in PgBouncer are unavailable. Automated 14-day PITR remains supported; separate on-demand snapshot backups are unavailable. Planned maintenance/restarts interrupt a non-HA server; maintenance rescheduling is unsupported. These are accepted intentional launch-size tradeoffs, not a production SLA claim. Monitor before workload growth, not after repeated outages.

- First upgrade for memory/connection or short-burst constraints: **Standard_B2s (2 vCPU/4 GiB)**, same dedicated server/database/network/data architecture; keep pools small and re-evaluate their combined budget.
- First upgrade when sustained CPU/credit depletion is limiting: **General Purpose**, selecting the smallest supported appropriate SKU at the time. Increasing Burstable memory alone does not remove the credit model.
- Vertical scaling does not require application/data migration, but causes a server restart and dropped in-flight connections; near-zero-downtime scaling does not apply to B1ms. Schedule the change, verify safe retry/reconnection behavior, then rerun migration/readiness/MCP regression and applicable owner dogfood tests. Do not rely on scaling while credits are depleted to be immediately successful.

Sources: [Azure PostgreSQL metric definitions](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-dbforpostgresql-flexibleservers-metrics), [compute guidance](https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute), [connection limits](https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits), [PgBouncer limitations](https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer), [Query Store warning](https://learn.microsoft.com/en-us/azure/postgresql/monitor/concepts-query-store), [scaling](https://learn.microsoft.com/en-us/azure/postgresql/scale/concepts-scaling-resources).


### Native metric-alert cost verification before provisioning

Verified 2026-10-09: all six planned rules use native PostgreSQL platform metrics. No PostgreSQL diagnostic settings, Log Analytics ingestion, SQL/query-text logs, Data Collection Rule, Application Insights or new workspace is required to evaluate these alerts. The current public retail meter `Alerts Metric Monitored` is $0.10/time-series/month after a first-ten free allowance; budget **up to $0.60/month for six single-resource/single-series static rules**, depending on allowance already used. Do not split dimensions into additional time series. Action-group notification charges, if any, are separate; use the approved simple operator notification path without auto-remediation. The six approved native metric alerts and operator action group are deployed, with owner-confirmed successful test/email receipt; no PostgreSQL diagnostic-log ingestion was added. Fixed PG/endpoint remains $23.39/month; adding these six rules gives approximately **$23.99/month before other usage costs** without free allowance. [Azure Monitor cost model](https://learn.microsoft.com/en-us/azure/azure-monitor/fundamentals/cost-usage).


## Approved PostgreSQL 18 deployment baseline

PostgreSQL 18 is the owner-approved V1 baseline for all new deployments and Phase 0 CI/database validation, superseding version 17. The reported East US 2 B1ms/version-18 attempt failed with `SkuNotAvailable`; regional capability listings do not prove allocation. North Central US B1ms with server name `monotorr-cw-db-01` is now the approved repository target. This naming/region baseline update does not authorize provisioning or modify Azure. Retain all networking, sizing and other approved settings.


## Server naming decision — 2026-10-10

All intended live operations target `monotorr-cw-db-01.postgres.database.azure.com` / ARM server `monotorr-cw-db-01`, database `connectwise`, region North Central US, PostgreSQL 18, B1ms and administrator `cw_bootstrap_admin`. The failed name `monotorr-cw-prod-pg` remains only in historical troubleshooting/preflight records; do not use it as a deployment target. The portal remains East US 2, and API/jobs/VNet/private endpoint remain East US. Existing endpoint name `pe-connectwise-prod-postgres` is unchanged; its target and DNS record must reference the new server. `deployment/azure/config.json` retains `location=eastus` because it controls compute, not PostgreSQL provisioning. No Azure resources are created or changed by this update.
