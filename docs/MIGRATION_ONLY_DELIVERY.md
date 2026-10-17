# Migration-only delivery

The reviewed `deploy-mcp.yml` workflow supports `action=migrate`. It uses the
existing production environment, GitHub OIDC identity, private migration job,
feature-scoped runner and private Blob receipt store. It does not create a
candidate, update an application, change traffic, publish a portal, or change RBAC.

## Provenance and order

Use a fresh immutable build of the exact reviewed workflow/source SHA. Build
evidence records the derived feature plan and original build run/attempt. The
migration action requires the usual `migrate:<SHA>` owner action approval and a
successful same-SHA `slice3-mcp-release` artifact through the existing evidence
downloader. Old build evidence without the new feature-plan/provenance fields is
not sufficient for this action. An unchanged immutable image is never retagged or
republished to accommodate the workflow change.

The release sequence is:

1. Build the exact reviewed source and record its feature plan.
2. Run `migrate` before candidate acceptance when schema is required. The existing
   MCP-affecting lane requires proven migration evidence before control preparation;
   a no-op migration still verifies the full required schema through the same runner.
3. Renew isolated MCP candidate acceptance using the successful migration evidence run.
4. Prepare control using the newest same-SHA evidence containing acceptance and migration proof.
5. Promote control, cut over MCP, and publish the portal under their existing approvals.

Example invocation (placeholders must be replaced with reviewed values):

```sh
gh workflow run deploy-mcp.yml \
  --repo robleon-git/connectwise-mcp --ref phase1-hardening \
  -f action=migrate -f reviewed_sha=<reviewed-sha> \
  -f owner_action_approval=migrate:<reviewed-sha> \
  -f evidence_run=<successful-same-sha-build-run>
```

Before job mutation, the action compares the current production baseline, derives
the feature plan through existing billing policy, compares it to build evidence,
and proves serving/rollback compatibility with the target's complete contract.
For Release B, Release A is the eligible rollback floor. The historical pre-A
runtime is not eligible after 0008. Compatibility failure stops before mutation.

Billing OFF selects `core`. The entire manifest/package/history is validated by
the existing runner, which applies only missing required migrations. For the
reviewed Release B schema, the expected result is 0008 applied and 0006/0007
deferred. There is no migration-number selection/skip option or manual SQL path.
The runner retains its advisory lock, transaction, checksums and history checks.

## Execution and proof

The migration execution sequence is shared with existing control preparation;
there is one implementation of job update/readback, single start, bounded status
polling and Blob completion polling. A compact UNPROVEN checkpoint is saved
before mutation and updated with the execution ID immediately after start.

Proof requires all of:

- Azure execution status `Succeeded` and exact execution image/command/arguments;
- exact start and completion Blob objects, without listing or log queries;
- matching repository, source SHA, image digest, run, attempt, request, execution,
  feature selection and manifest fingerprint;
- successful schema verification and transaction acknowledgement;
- validated applied, deferred and installed-optional migration IDs.

GitHub uses its existing exact-object OIDC reader. No local operator Blob grant,
shared key, broader reader or new infrastructure is needed. Start/completion
payloads remain only in the 30-day breadcrumb artifact and the existing expiring
Blob paths. The longer-lived release evidence stores compact correlation,
attestation hash, result IDs, feature plan and compatibility proof, not receipt events.

Later candidate/acceptance, preparation, promotion and cutover steps verify the
same recorded execution and exact receipts. Reuse may outlive the initial
one-hour ingestion window, but requires the already-recorded receipt hash and
expires after 30 days; it does not permit a stale new execution. Missing, expired,
changed or mismatched proof fails closed. Application runtime readiness continues
to validate installed history independently.

Control preparation reuses proven execution evidence and does not update or
start the migration job again. Omitting required proof from the new release lane
is rejected before control/traffic mutation. Existing control-only protection
and historical release validation remain in place.

## Failure and recovery

A database commit followed by failed receipt publication is UNPROVEN. Azure
success alone is insufficient. Failed, timed-out or ambiguous execution never
triggers an automatic retry. Repeating `migrate` with proven evidence only
revalidates it; repeating it with an UNPROVEN checkpoint refuses to start again.

After failure, retain the failed workflow artifacts and inspect actual job,
database and exact receipt state before deciding on any manual retry. Do not
select older build-only evidence to hide a failed attempt. If receipts have
expired or the execution record is unavailable, stop for a separately reviewed
recovery decision; do not rerun merely to manufacture proof. Migrations remain
forward-only, and rollback uses the compatible Release A artifacts without
removing 0008 or reversing the approved grant.

This repository implementation has not executed a production migration or
changed Azure, application traffic, billing, Stripe or Descope.
