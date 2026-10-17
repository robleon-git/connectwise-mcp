# Feature-scoped schema readiness

Status: repository-only readiness and execution correction; deployment remains blocked pending review and renewed same-SHA provenance. No release image publication, live migration, infrastructure change, or billing enablement is included.

## One manifest, two uses

`src/database/migrationManifest.ts` remains authoritative for every migration's ID, file, checksum and mandatory `requirement` (`core` or `billing`). Existing migrations through the multi-source entitlement reader are core. Billing foundation and Checkout migrations are feature-scoped. Classification is explicit metadata; runtime logic never derives it from a migration number or filename.

The same module validates manifest order/uniqueness, metadata, required migration selection and installed history. Execution requires unique, manifest-known installed IDs with exact checksums. Runtime readiness additionally accepts only the exact later IDs/checksums in its embedded forward-compatibility catalog, described below. Missing required schema, corrupt optional installed schema, malformed/unknown requirement metadata, invalid/ambiguous history, and query failure fail closed. Installed-history row order does not affect verification. Core migrations are always required; disabled-feature migrations may be absent, but are not exempt from checksum validation if installed.

## Runtime gates

Control computes `billingConfig()` once using the existing TEST-only, default-OFF policy. The resulting validated configuration determines both runtime construction and readiness requirements. No second environment-flag interpretation exists.

With billing OFF, control requires core schema and does not construct billing services, expose billing routes, or start the billing worker. With billing ON in an allowed nonproduction TEST configuration, core and billing schema must be verified before billing construction, routes, worker or socket binding. Readiness continues to verify the same required feature set. Invalid production/test configuration retains the existing startup failure policy. Liveness remains distinct from schema readiness.

Hosted MCP performs the same read-only history verification for core schema before opening its socket. It has no billing runtime and imports neither Stripe nor billing configuration/services to select requirements. Optional installed migrations still have their checksums checked. Existing authentication, entitlement decisions, account isolation, tool inventory and schemas are unchanged.

## Feature-scoped migration execution

One authoritative manifest and one runner serve readiness, execution and delivery. The CLI requires exactly one nonsecret execution argument: `core` or `core,billing`. Missing, malformed, duplicated or unknown requirements fail before database construction. The existing read-only `--verify-slice1` diagnostic remains separate and cannot execute migrations. No migration-number limit, skip flag, ignore-feature override or manual SQL path exists.

The CLI loads **every** manifest entry and SQL file, verifies every checksum, and passes the complete loaded package plus an explicit feature set to the runner. The runner never uses a filtered package to evade optional history verification. It validates selection/metadata/SQL before connecting, acquires the existing advisory lock, begins the existing transaction, then validates all installed history under that lock to avoid a concurrent-runner race. Only missing selected migrations execute, in manifest order. A final database history read must prove all required migrations present before COMMIT. History mismatch, missing required schema or SQL failure causes rollback and sanitized failure. Existing locks, timeouts and client cleanup remain.

Core is always selected. With billing disabled, missing billing migrations are explicitly deferred, not implicitly successful or recorded as installed. With valid TEST billing enabled, core and billing are selected. Installed optional migrations remain installed and checksum-validated when billing is later disabled. Execution reports `requirements`, `applied`, `appliedIds`, `deferredIds` and `installedOptionalIds`; these contain identifiers only, never SQL, credentials or raw errors.

### Migration authoring invariant

**Core migrations must not depend on unapplied feature-scoped schema.** A later independent core migration may execute while an earlier billing migration remains deferred. Manifest order governs the selected migrations; installed history need not be a contiguous prefix. There is no automatic dependency promotion that enables a disabled feature. Review SQL dependencies and run the complete core projection against an empty disposable database with billing schema absent. If a core migration references missing billing schema, execution fails and rolls back; fix the migration classification/design rather than broadening selection automatically.

## Delivery propagation

The existing `prepare-control` path and migration job remain. Production preparation inherits the existing application configuration; its existing overrides affect setup/linking, not billing. Delivery reads only nonsecret `NODE_ENV`/`CW_BILLING_ENABLED` values from the target application's template, rejects ambiguous/duplicate/secret-referenced flags, and uses the **existing compiled `billingConfig()`** policy. The reviewed image's production default applies if NODE_ENV is absent. This production-only delivery path rejects a nonproduction target and retains the existing prohibition on production billing opt-in. No Stripe key is read to select current production schema, and the migration job does not interpret its own feature flags.

The release records a `schemaPlan` with the explicit selection, requirements, required/optional IDs and a fingerprint of the entire validated migration package. The immutable job image, command `node`, and arguments `dist/database/cli.js core` (for the current target) are updated and read back before starting. MCP-affecting preparation still runs the job even if no core migrations are pending. Job success alone is insufficient: its exact execution's sanitized completion event must be retrievable and match the plan. Missing/ambiguous completion evidence stops preparation without rerunning migrations. Only allowlisted completion fields are copied into `migrationResult` in the existing control/release evidence.

Preparation rechecks feature selection before and after candidate creation. Promotion rechecks both application-template and prepared-revision selection against the recorded plan; MCP cutover rechecks the promoted control revision and template. Missing plans, manifest drift or feature drift fail closed before traffic/runtime mutation. The existing migration-free control-only lane additionally requires no feature expansion relative to the serving revision, alongside its unchanged full-schema, executable-impact and readiness proofs. A feature expansion cannot silently use that lane.

Both existing delivery workflows compile the reviewed source locally before loading configuration guards. This neither publishes images nor adds a workflow action. Initial job rendering obtains its explicit selection from the rendered application environment. Future permitted billing enablement uses the same manifest, job and normal deployment flow; current production billing remains forbidden by unchanged product policy.

## Forward-only schema and rollback

Application rollback never removes migrations or optional schema and does not run the migration job. A transaction failure leaves no newly installed schema; a successful migration followed by a deployment failure leaves additive schema installed, while prior application traffic is retained. Migrations must remain compatible with the retained rollback artifact. Preserve existing production, candidate acceptance, image and rollback evidence. No down migration or automatic optional-schema removal is introduced.

## Conservative delivery remains required

This release is MCP-affecting: startup code/manifest requirements changed, and the deployed-to-target package/lock inputs also changed. The MCP-impact comparator, protected inputs, unknown-impact rejection, full candidate acceptance, same-SHA provenance, explicit traffic readback and rollback controls are not relaxed.

The schema-compatibility parser accepts the existing legacy literal format and the explicit tagged format with known manifest helpers. It never evaluates source. It still requires exact equality of the complete manifest source and every SQL file/checksum; it does not compare only the enabled-feature subset. Changed metadata/helper source is a schema difference. Unknown metadata, extra top-level execution, malformed source and mixed/ambiguous formats are rejected.

The execution correction removes unconditional optional-migration application in source; billing OFF still does not skip the job. This is not deployment authorization. Review/commit the correction and renew immutable same-SHA build, candidate acceptance and release evidence before invoking delivery. Existing historical evidence cannot be relabeled for the new source. No guard bypass, approval override or control-only reclassification is supplied.

## Acceptance evidence

Tests cover core-only readiness, missing core/feature schema, core/optional checksum corruption, malformed metadata/history, query failure, actual control and MCP entrypoint ordering, absence of partial billing exposure, explicit feature-scoped ordered execution, and unchanged release authorization/migration gates. PostgreSQL 18 integration uses an isolated disposable local fixture: it proves core-only readiness first, then explicitly enables feature execution inside that fixture and disables it again while retaining installed schema. This is not a production migration.

The 39 MCP read tools, zero write tools and tool schemas remain separately verified from executable-module impact. Local validation output belongs in ignored `.delivery/schema-readiness/`; it is not release provenance or authority to deploy. Unrelated local documentation and historical continuity files remain excluded.

Execution-specific local validation belongs in ignored `.delivery/migration-execution/`. Genuine live migration-job command/log transport and effective permissions must be verified during the normal authorized deployment preflight; repository tests mock Azure, and do not claim live delivery occurred. If logs are unavailable after execution, stop and inspect actual history/evidence; do not blindly retry the job.

## Release A: pinned forward-history compatibility

Execution authority remains the `MIGRATIONS` manifest (0001–0007). Runtime
readiness has a separate literal `FORWARD_COMPATIBILITY` catalog in the same
module. Release A pins only `0008_account_name_edit` to
`db9c40c882343deb5eec9d26b06355665807e22ba7075ada0cf66efaf6977729`.
It neither requires nor ships/executes that SQL. Billing OFF still requires only
core 0001–0005. Catalog IDs must be unique, well formed, checksum pinned, ordered
and strictly later than every execution-manifest version; gaps are allowed.

Both MCP pre-listen verification and control readiness validate every installed
row. Missing required rows, known or catalog checksum changes, malformed or
duplicate history/catalog metadata, unlisted history and database failures fail
closed. A larger migration number alone is never evidence of compatibility.
The strict migration runner intentionally ignores the catalog and rejects any
installed migration outside its own execution manifest. Never use an older
migration runner as a rollback operation.

Preparation reads immutable registry digest/source provenance and parses the
serving MCP/control source contracts as literal data, without executing source.
It validates the complete SQL package against those manifests. Before traffic,
job or candidate mutation, every target-required migration must be supported by
both serving artifacts and the explicitly eligible retained rollback pair,
either in their execution manifests or exact catalogs. Existing executable SQL
cannot disappear or change, including disabled-feature migrations.

The `schemaCompatibility` proof binds the source SHA, target images, feature
plan, full source/SQL/catalog fingerprints, serving revisions/images and explicit
eligible rollback revisions/images. It lives in active release evidence, not
30-day migration receipts. Promotion/cutover recompute it from exact registry
objects, Git source and retained/live revisions; missing proof, feature drift,
provenance drift and artifact changes fail before live mutation. Candidate
acceptance remains a separate mandatory, exact-SHA/image/revision requirement.

Only the serving pair captured at preparation is designated eligible rollback;
other retained revisions remain historical. Both rollback artifacts must accept
the identical set of history ID/checksum pairs. Before rollback, verify the exact
retained control artifact's `/ready` against the current database. This prevents
replaying an earlier release proof after a future schema change. Inactive MCP
revisions are retained by image/template provenance and need not already be
running; existing copy/readiness polling still applies after rollback. Delivery
continues to use the existing serialized production workflow and owner gates.

| Runtime | Core 0001–0005 | Core plus exact 0008 |
| --- | --- | --- |
| Original 217e1d | Ready | Reject |
| Release A | Ready | Ready |
| Account-name Release B | Reject | Ready |

Release A changes runtime verification, so the cumulative release remains
MCP-affecting. It needs a new exact-SHA build and fresh candidate acceptance.
No SQL, authentication, entitlement or tool-schema changes are part of A.

## Release B: required account-name grant

Release B restores the reviewed account-name feature and the exact 0008 SQL.
The execution manifest now contains 0001–0008; `0008_account_name_edit` is core
and no longer appears in the future catalog. The catalog is empty, while its
validation and all fail-closed runtime/history rules remain unchanged.

With billing OFF, the normal `core` plan requires 0001–0005 plus 0008 and defers
0006/0007. Against the current production ledger, only 0008 is missing. Both
Release B readiness gates reject that ledger until 0008 is installed.

Production Release A (`1d13310c600c35e3c42a5d04b21927b6d7422c68`) remains the
rollback floor after 0008, through its exact checksum-pinned catalog. Retain its
MCP/control pair. The historical 217e1d artifacts are not eligible rollback
choices after 0008. Rollback restores a compatible runtime; it never removes the
migration row, reverses the grant, or runs an old migration package. Existing
preparation/promotion/cutover guards enforce the artifact-bound compatibility
proof. Release B remains MCP-affecting and needs fresh same-SHA provenance and
candidate acceptance before deployment. No production migration is performed by
repository preparation.
