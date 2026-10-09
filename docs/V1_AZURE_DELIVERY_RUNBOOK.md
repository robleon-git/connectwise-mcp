# V1 Phase 0 Azure Delivery Runbook

Status: repository implementation prepared for review; no Azure resource creation, resource mutation, workflow dispatch, commit, push, or deployment performed. Phase 0 is not complete until authorized live deployment/smoke/rollback gates pass.

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
| `connectwise-portal` | New group | New Standard Static Web App, Azure-generated hostname, no linked Functions API or Monotorr app |
| `monotorr-cw-prod-pg` | New group | Proposed globally unique PostgreSQL 17 flexible server, dedicated database boundary |
| `connectwise` | New PostgreSQL server | Create dedicated product database |
| `cw-deploy-identity` | New group | User-assigned deployment identity with GitHub environment-scoped federation |
| `connectwise-migrate` | New group | Manual Container Apps job, shared control image, separate system identity and migration DB role |
| `connectwise-bootstrap` | New group, temporary | Explicit operator-only job, distinct system identity, no retries, 180-second execution limit; delete after bootstrap or failure |
| Existing MCP app/environment/ACR/vault/pull identity | Existing group | Preserve and reuse; no move, recreation, MCP image change, revision-mode change, traffic change, or probe change |
| New database private endpoint/NIC | New group where possible | `pe-connectwise-prod-postgres` on existing `snet-monotorr-private-endpoints` (`10.42.0.32/28`); allocate a new IP, preserve `10.42.0.36` |
| Existing PostgreSQL private DNS zone | Existing group | Add a zone group for the new private endpoint; do not change existing Monotorr records/links |

The candidate server name must pass Azure availability checks before creation. Proposed starting SKU: General Purpose `Standard_D2ds_v5` (2 vCPU), 32 GiB storage with autogrow, 14-day backups, PostgreSQL 17, no HA initially. This is a small dedicated production-shaped boundary, not a capacity/SLA guarantee. Review actual region availability and Azure cost estimate before creation. Do not move to the existing Monotorr B1ms database to avoid this decision.

Reuse the existing shared environment, registry, approved network and logging as infrastructure only. Separate applications, runtime identities, database/roles, secrets and configuration remain mandatory. Existing ACR has `LegacyRegistryPermissions`; it is not repository-scoped ABAC. Proposed `AcrPush` is registry-wide. The scripts hard-pin the ConnectWise control repository, but that is not an Azure IAM boundary. Registry-scoped `AcrPush` for the dedicated repository/workflow OIDC identity is an explicitly accepted V1 infrastructure constraint. No ABAC migration is authorized in Phase 0. Existing `connectwise-mcp-pull-id` and `monotorr-api-prod-pull-id` AcrPull assignments remain unchanged; do not use registry admin credentials or grant subscription Owner.

## Commands/actions for operator review before any live change

Run from the canonical repository only. These are future actions, NOT instructions to execute before repository review and live-action approval. Do not use shell tracing/debug flags. No password/token values belong in argv or shell history.

```sh
az group create --name monotorr-connectwise-prod-rg --location eastus --output none
az identity create --name cw-deploy-identity --resource-group monotorr-connectwise-prod-rg --location eastus --output none
az identity federated-credential create --name github-connectwise-production --identity-name cw-deploy-identity --resource-group monotorr-connectwise-prod-rg --issuer https://token.actions.githubusercontent.com --subject repo:robleon-git/connectwise-mcp:environment:connectwise-production --audiences api://AzureADTokenExchange --output none
az staticwebapp create --name connectwise-portal --resource-group monotorr-connectwise-prod-rg --location eastus2 --sku Standard --output none
```

Database creation is an Azure portal action to avoid putting the bootstrap administrator password in a CLI argument. Use the proposed server/SKU/database settings above; administrator `cw_bootstrap_admin`; create/store its strong password securely as `cw-bootstrap-db-password` in `cw-mcp-kv`. Do not display/copy it through diagnostic commands. Use private endpoint networking to the approved existing VNet with correct private DNS; leave public access disabled with no public firewall allowances; verify connectivity from the private job. Do not add `0.0.0.0` Azure-wide firewall access or weaken TLS. Record exact approved subnet/private endpoint IDs before performing this networking action.

After server creation:

```sh
az postgres flexible-server db create --resource-group monotorr-connectwise-prod-rg --server-name monotorr-cw-prod-pg --database-name connectwise --output none
```

Database bootstrap now runs as the temporary `connectwise-bootstrap` job inside the existing ACA environment. No laptop or GitHub-hosted runner connects to PostgreSQL. The bootstrap runner is compiled into the reviewed control image as `dist/database/bootstrap-cli.js`; API startup and the normal migrator never invoke it. `scripts/deploy/bootstrap-database.mjs` is management-plane orchestration only and receives no passwords.

The two service-secret names must initially contain the NONSECRET marker `__CW_DATABASE_BOOTSTRAP_PENDING__`. This allows secret-specific role assignments before bootstrap, without granting vault-wide write access. Bootstrap refuses absent placeholders, existing role/password state, overlapping bootstrap execution, unsafe target configuration, or a non-admin database session. It generates distinct passwords in memory, replaces only those two placeholders, and grants separate non-superuser/non-CREATEROLE roles. Temporary migrator SET/INHERIT privileges used for default SELECT privileges are revoked within the SQL transaction. PostgreSQL 17 may retain the creator administrator’s automatic ADMIN-only membership; that is part of the infrastructure administrator’s role-management authority, not permission granted to a running application.

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

Create the protected GitHub environment `connectwise-production`: required reviewer, approved deployment branches, no bypass of manual approval, and variable `CW_AZURE_DEPLOY_CLIENT_ID` set to the deployment identity's nonsecret client ID. Workflows are manual only. Tests/builds/audits run in a job WITHOUT production environment access or OIDC issuance permissions. Only after those gates pass does the protected delivery job receive OIDC permissions; it reuses verified portal assets and does not execute npm build scripts with deployment credentials. Static Web Apps' official deploy action still requires its transport token; the workflow obtains it through OIDC-authenticated ARM, masks it immediately, and passes it directly to the action. It is not stored as a long-lived GitHub secret or artifact and is not printed. This Azure transport token is not product user authentication. Built-in SWA login routes are blocked in the Phase 0 portal.

## Release process and environment contract

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

Database integration locally: use a disposable PostgreSQL 17 container bound to `127.0.0.1`, database `cw_delivery_test`, and a SYNTHETIC local-only password. Set `CW_DATABASE_INTEGRATION=true`, `CW_DB_HOST=127.0.0.1`, `CW_DB_PORT`, `CW_DB_NAME=cw_delivery_test`, `CW_DB_USER=postgres`, and `CW_DB_LOCAL_PASSWORD` for `npm run test:database`. The tests refuse an Azure/non-disposable target and also create/drop a separate `connectwise` test database and bootstrap/runtime/migrator roles inside that disposable container. Never point these tests at a shared local database. Remove the container afterward. Committed CI passwords are explicitly synthetic and exist only in the ephemeral CI container.

## Rollback and completion limits

MCP revision mode, traffic, probes, images and configuration are NOT managed by the Phase 0 release workflow. No DNS/custom-domain/Descope/ConnectWise changes are authorized here. Candidate labels/revisions apply only to the NEW control API. Existing MCP health/protocol behavior is tested, not replaced.

Do not restore customer entitlement/secret/connection state during rollback. Readiness requires the current image's known migration checksums but tolerates additional additive migrations so older compatible API revisions can remain healthy. Migrations validate full immutable history before application. Destructive compatibility changes need separate review.

Phase 0 remains incomplete until actual infrastructure approval, Azure bootstrap, deployed API/portal/database checks, authorized authenticated MCP smoke, and a NEW API rollback rehearsal succeed. Current repository validation cannot claim those future gates passed. There is no Phase 1 signup/account/identity/entitlement/customer-connection/admin/billing functionality in this change.

Sources: [Container Apps probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes), [jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs), [revisions/configuration scope](https://learn.microsoft.com/en-us/azure/container-apps/revisions), [SWA deploy action inputs](https://raw.githubusercontent.com/Azure/static-web-apps-deploy/v1/action.yml), [SWA tokens](https://learn.microsoft.com/en-us/azure/static-web-apps/deployment-token-management).


## Current Phase 0 release blocker: inherited build-chain audit

Production `npm audit --omit=dev` is clean. The full audit initially found four high-severity development/build advisories at versions already present in the committed lockfile. A compatible source-map-js patch resolves one. Three remain in `braces`, `micromatch`, and `vite-plugin-singlefile`. npm proposes a breaking downgrade of the ticket-card plugin; that has not been applied because it would change the preserved MCP UI build path without review.

Both CI and manual delivery now require the full audit as well as the production audit. Consequently artifact publication/deployment is intentionally blocked until a reviewed resolution or explicit, narrowly scoped approved risk policy is implemented. There is no force-fix, ignore flag, or silent audit bypass. The independent builds/tests/production audit can pass while this release gate remains blocked. Resolve this during Phase 0, not near launch.

## Exact private networking and bootstrap actions — future operator execution only

These actions require separate live-resource approval. No commands in this section were executed during repository preparation. Run from the canonical repository without shell tracing. All password entry is through secure Azure portal forms; do not put passwords in arguments, environment files, artifacts, or GitHub.

1. Create the dedicated resource group, deployment identity/federation and portal using the commands above. Confirm the proposed PostgreSQL name/SKU/region availability and cost; create the dedicated PostgreSQL 17 server in the new group through the portal with administrator `cw_bootstrap_admin`, public access disabled and no public firewall allowances. Securely create `cw-bootstrap-db-password` in `cw-mcp-kv` through the portal; never retrieve it with an operator CLI. Create the `connectwise` database via ARM as shown above.
2. Attach a new private endpoint to the existing nondelegated private-endpoint subnet. Reuse the existing DNS zone/link without changing existing records. No new VNet, gateway, peering, VPN or database delegation is required.

```sh
CW_SUBSCRIPTION='08a97e42-1e1f-4f33-95dc-36af13337091'
CW_NEW_RG='monotorr-connectwise-prod-rg'
CW_SHARED_RG='monotorr-dev-eastus-rg'
CW_PG_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_NEW_RG/providers/Microsoft.DBforPostgreSQL/flexibleServers/monotorr-cw-prod-pg"
CW_SUBNET_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.Network/virtualNetworks/monotorr-prod-vnet/subnets/snet-monotorr-private-endpoints"
CW_DNS_ID="/subscriptions/$CW_SUBSCRIPTION/resourceGroups/$CW_SHARED_RG/providers/Microsoft.Network/privateDnsZones/privatelink.postgres.database.azure.com"
az network private-endpoint create --name pe-connectwise-prod-postgres --resource-group "$CW_NEW_RG" --location eastus --subnet "$CW_SUBNET_ID" --private-connection-resource-id "$CW_PG_ID" --group-id postgresqlServer --connection-name connectwise-postgres --output none
az network private-endpoint dns-zone-group create --resource-group "$CW_NEW_RG" --endpoint-name pe-connectwise-prod-postgres --name default --private-dns-zone "$CW_DNS_ID" --zone-name postgres --output none
az postgres flexible-server update --resource-group "$CW_NEW_RG" --name monotorr-cw-prod-pg --public-access Disabled --output none
```

Private DNS must resolve `monotorr-cw-prod-pg.postgres.database.azure.com` to the new endpoint from ACA. Connections use this canonical name with certificate verification on TCP 5432. A private endpoint does not independently isolate other workloads in the shared VNet; separate database roles, Vault RBAC and product identities remain the credential/access boundary. The existing private-endpoint subnet has network policies disabled; this plan does not change its shared policy or existing endpoint.

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
