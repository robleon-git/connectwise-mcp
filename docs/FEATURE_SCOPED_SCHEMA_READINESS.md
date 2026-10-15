# Feature-scoped schema readiness

Status: repository-only correction; deployment remains blocked. No release image publication, live migration, infrastructure change, or billing enablement is included.

## One manifest, two uses

`src/database/migrationManifest.ts` remains authoritative for every migration's ID, file, checksum and mandatory `requirement` (`core` or `billing`). Existing migrations through the multi-source entitlement reader are core. Billing foundation and Checkout migrations are feature-scoped. Classification is explicit metadata; runtime logic never derives it from a migration number or filename.

The same module validates manifest order/uniqueness, metadata, required migration selection and installed history. All installed history must contain unique, known IDs with exact checksums. Missing required schema, corrupt optional installed schema, malformed/unknown requirement metadata, invalid/ambiguous history, and query failure fail closed. Installed-history row order does not affect verification. Core migrations are always required; disabled-feature migrations may be absent, but are not exempt from checksum validation if installed.

## Runtime gates

Control computes `billingConfig()` once using the existing TEST-only, default-OFF policy. The resulting validated configuration determines both runtime construction and readiness requirements. No second environment-flag interpretation exists.

With billing OFF, control requires core schema and does not construct billing services, expose billing routes, or start the billing worker. With billing ON in an allowed nonproduction TEST configuration, core and billing schema must be verified before billing construction, routes, worker or socket binding. Readiness continues to verify the same required feature set. Invalid production/test configuration retains the existing startup failure policy. Liveness remains distinct from schema readiness.

Hosted MCP performs the same read-only history verification for core schema before opening its socket. It has no billing runtime and imports neither Stripe nor billing configuration/services to select requirements. Optional installed migrations still have their checksums checked. Existing authentication, entitlement decisions, account isolation, tool inventory and schemas are unchanged.

## Migration execution is not feature-scoped

The normal migration CLI still loads, checksum-validates and executes the entire ordered manifest, including unapplied billing migrations. The runner rejects malformed metadata, changed SQL and invalid/duplicate installed history. Runtime selection is never passed as a filtered migration list by the CLI. Existing advisory locking, transaction boundaries, history records and rollback behavior remain. No SQL file or registered checksum changes.

## Conservative delivery remains required

This release is MCP-affecting: startup code/manifest requirements changed, and the deployed-to-target package/lock inputs also changed. The MCP-impact comparator, protected inputs, unknown-impact rejection, full candidate acceptance, same-SHA provenance, explicit traffic readback and rollback controls are not relaxed.

The schema-compatibility parser accepts the existing legacy literal format and the explicit tagged format with known manifest helpers. It never evaluates source. It still requires exact equality of the complete manifest source and every SQL file/checksum; it does not compare only the enabled-feature subset. Changed metadata/helper source is a schema difference. Unknown metadata, extra top-level execution, malformed source and mixed/ambiguous formats are rejected.

The readiness correction does **not** solve the delivery/migration-job blocker. Current MCP-affecting `prepare-control` updates and runs `connectwise-migrate`, which executes all migrations. Billing OFF does not skip that job. Because applying billing migrations is not authorized, do not invoke this path. A separately reviewed delivery decision is required before preparation; no skip flag, approval override or control-only reclassification is supplied here.

## Acceptance evidence

Tests cover core-only readiness, missing core/feature schema, core/optional checksum corruption, malformed metadata/history, query failure, actual control and MCP entrypoint ordering, absence of partial billing exposure, full ordered migration execution, and unchanged release authorization/migration gates. PostgreSQL 18 integration uses an isolated disposable local fixture: it proves core-only readiness first, then explicitly applies feature migrations inside that fixture to verify full runner behavior. This is not a production migration.

The 39 MCP read tools, zero write tools and tool schemas remain separately verified from executable-module impact. Local validation output belongs in ignored `.delivery/schema-readiness/`; it is not release provenance or authority to deploy. Unrelated local documentation and historical continuity files remain excluded.
