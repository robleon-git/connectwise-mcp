# Isolated migration receipts

Repository implementation only. No Azure resource, permission, retention, deployment, or production migration changes have been performed. The uncommitted shared Log Analytics transport has been replaced; it must not be committed as the receipt design.

## Storage and receipt model

Use a dedicated Standard LRS StorageV2 account and private receipt-only container. Nonsecret proposed names are in `deployment/azure/migration-receipts.json`; account name availability must be checked before provisioning. The endpoint is derived as `https://<account>.blob.core.windows.net/<container>`, never accepted as an arbitrary URL.

Object keys are:

```
v1/<sha>/<github-run>/<attempt>/<request-id>/<execution-id>/start.json
v1/<sha>/<github-run>/<attempt>/<request-id>/<execution-id>/completion.json
```

Schema `migration-breadcrumb-v1` contains a start event and one terminal success OR failure event in separate immutable/create-only block blobs. Correlation contains the repository, exact source SHA, immutable control image URI/digest, GitHub run and attempt, random request UUID, reviewed feature selection, complete manifest fingerprint, Azure execution name, and timestamps. Success includes applied IDs, deferred optional IDs, validated installed optional IDs, schema verification and acknowledged COMMIT. Failure records schema verification false, transaction acknowledgement false, outcome unproven, and unknown/null migration ID lists. Those flags do not assert that rollback occurred or that a lost COMMIT acknowledgement means the transaction did not commit.

The start must be durably created before database construction/execution. Success is published only after the unchanged feature-scoped runner verifies full history and receives COMMIT acknowledgement. Controlled migration failure publishes a failure completion where possible. Process death may leave only a start receipt.

Publication uses the existing job's system-assigned managed identity, a Storage audience token, HTTPS, a single Put Blob with `x-ms-blob-type: BlockBlob` and `If-None-Match: *`. HTTP 201 is required. HTTP 409/412 conflicts and all ambiguous/failed uploads fail closed. There is no upload retry. Existing blobs cannot be overwritten through the reviewed job role. This is immutability against release identities, not WORM protection against storage administrators. No locked retention policy is needed.

Detailed receipts are not emitted to stdout/stderr, copied to shared Log Analytics, or printed by GitHub. Normal sanitized category-only operational failures remain. No database credentials, customer data, SQL, Stripe credentials, ConnectWise credentials, authorization headers or access tokens are serialized into receipts or release artifacts.

## Retrieval and release gate

GitHub uses its existing OIDC Azure session to obtain a Storage token privately. It issues exact authenticated GET requests for the expected two object keys. It never lists blobs, searches for latest, queries Log Analytics, or fetches terminated-replica logs. Tokens remain in process memory and are not passed as shell arguments or logged. Redirects, oversized responses, malformed JSON, authorization failures and missing-container errors stop the operation. Only an actual `BlobNotFound` response is treated as pollable absence.

Before any release mutation, read-only preflight verifies account security flags, private-container settings, disabled versioning/soft-delete/restore, the reviewed lifecycle rule, exact-blob read permission, and migration-job policy (zero retries, one parallel replica, one completion). Required metadata read permissions are listed below. The access probe GETs a reserved exact missing key, not a container listing. Configuration changes are never made by preflight.

The coordinator binds nonsecret context and storage configuration into the job, checks readback, and verifies the actual Azure execution template's image, command, explicit feature arguments, context and store. Receipt validation independently checks all correlation fields, timestamps, exact schema, matching start/terminal records, complete migration result, schema success and COMMIT acknowledgement. Unexpected fields, wrong execution/SHA/features, conflicting values, failed completion or missing evidence cannot pass.

Both Azure execution success AND matching successful receipts are mandatory. Poll exact blobs every 15 seconds for at most 10 minutes, with bounded token acquisition/download timeouts. Missing or incomplete evidence times out; transport/access failures stop immediately. No migration is automatically rerun. If the database commits but completion publication fails, the CLI exits unsuccessfully and does not attempt a second terminal record. The release remains UNPROVEN. Inspect the existing execution, schema history and any receipt before separately deciding recovery; never infer rollback from missing evidence.

The existing full-package/checksum/history validation, explicit `core` / `core,billing` selection, control-only migration-free lane, source/image provenance, acceptance, traffic and rollback protections remain unchanged. Billing remains OFF. No migration SQL, entitlement policy or MCP executable module is changed by the transport.

## Identities and exact permissions

All data assignments are at:

`/subscriptions/<subscription>/resourceGroups/<product-group>/providers/Microsoft.Storage/storageAccounts/<account>/blobServices/default/containers/<container>`

Migration job system identity:

* DataActions: only `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action`.
* Actions: none. No read/list/write-overwrite/delete/lifecycle/RBAC permissions.
* Use single block-blob Put Blob. Do not grant Storage Blob Data Contributor. The add action also covers other create/append operations; the reviewed producer only creates block blobs and never requests snapshots or append blobs.

GitHub principal `9c8fd37b-b308-4a9d-beef-018459764029`:

* DataActions: only `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read`.
* Attach conditionVersion `2.0` and this condition to deny the List Blobs suboperation, which otherwise shares the read action:

```
!(ActionMatches{'Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read'} AND SubOperationMatches{'Blob.List'})
```

* Reuse sufficient existing metadata-read permissions when present; otherwise assign a metadata-only custom role at the exact account with Actions:
  * `Microsoft.Storage/storageAccounts/read`
  * `Microsoft.Storage/storageAccounts/blobServices/read`
  * `Microsoft.Storage/storageAccounts/blobServices/containers/read`
  * `Microsoft.Storage/storageAccounts/managementPolicies/read`
* No data writes, delete, list, shared-key access, lifecycle edits, RBAC administration or workspace query permission.

RBAC is additive. Verify inherited roles do not restore denied operations. Provisioning acceptance must demonstrate: job creates new blocks but cannot read/list/overwrite/delete; GitHub reads exact blobs but cannot list/create/overwrite/delete or read other containers. Local tests validate request construction and role proposals; they do not claim to prove live RBAC enforcement.

See [Put Blob permissions](https://learn.microsoft.com/en-us/rest/api/storageservices/put-blob?tabs=azure-ad) and [Blob read/list ABAC suboperations](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-auth-abac-attributes).

## Retention and provenance

Application verification explicitly rejects evidence older than 30 days. Fresh preparation is stricter: a receipt must also belong to the current request window (at most one hour), with matching request/run/attempt/execution. Physical object existence cannot override logical expiry.

Use an account lifecycle policy scoped only to `<container>/v1/`, deleting block blobs after 30 days since modification. Create-only receipts are not modified after creation. Lifecycle deletion is asynchronous: approximately 30 days, not a guaranteed physical deletion deadline. Disable blob/container soft delete, versioning and restore. Do not provision snapshots, backups, object replication, legal holds or locked retention policies that extend this short-lived store. Separately verify no external backup/protection policy covers the new account before approval; metadata preflight cannot prove every external backup arrangement.

A separate GitHub operational artifact retains validated detailed receipts/incomplete outcomes for 30 days. Active-release/rollback artifacts keep only the compact receipt hash/schema-success attestation, source/images, schema plan, acceptance and rollback references. Their existing lifetime is preserved. Expired operational receipts are not needed to roll back an accepted release, and cannot be reused as fresh evidence.

[Azure lifecycle deletion is asynchronous](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-policy-faq); [soft delete extends storage lifetime](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-policy-delete).

## Infrastructure proposal and release flow

`node scripts/deploy/render-migration-receipts.mjs` renders review-only account/service/container/lifecycle and role proposals under `.delivery/`. It contains no Azure write call or assignment execution. Resource names come from the dedicated configuration file. The account should be dedicated to avoid changing protection settings on unrelated data. Anonymous access and Shared Key authorization must be disabled, HTTPS required and minimum TLS 1.2 enforced. An authenticated public endpoint is compatible with hosted GitHub runners; private networking would require a separately reviewed runner/job network path. No account keys or SAS secrets are required.

Azure prerequisites, not performed:

1. Verify proposed account name availability and approve/create the dedicated account, service configuration, private container and lifecycle policy.
2. Approve/create the narrow custom role definitions and exact-container data assignments, including the GitHub no-list ABAC condition. Reuse any existing sufficient metadata-read grant rather than adding a redundant assignment; the renderer includes a minimal metadata-reader proposal for use only if needed.
3. Verify effective positive/negative permissions and network reachability for the existing migration identity and GitHub identity. Confirm no external backups/extra copies are configured.
4. Commit only after repository review, then perform a new same-SHA immutable build and renewed acceptance through the existing release flow. Prior images/acceptance cannot be relabeled for new source.

These are initial resource prerequisites, not a new per-release approval stage. The normal path remains develop → QA → pre-production verification → deploy → live acceptance. No shared Log Analytics retention, query access, table access, immediate-purge setting or logging-platform change is required. No cleanup job, database table or permanent audit platform is introduced.
