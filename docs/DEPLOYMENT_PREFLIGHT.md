# Deployment preflight policy

Normal releases use the serving production release as the known-good functional baseline. This policy supersedes older operational instructions requiring fresh owner/browser attestations; historical acceptance records remain historical evidence.

Before deployment, do not request portal login, Microsoft owner authentication, ChatGPT connection tests, boards/priorities reads, authenticated inventory, browser callback handling or private-window cleanup solely to prove the old release works. The `owner_baseline_connected` and `baseline_read_tools_verified` workflow inputs and corresponding build-evidence attestations have been removed. Do not substitute equivalent manual checks.

Keep the existing machine checks: reviewed checkout/remote SHA, trusted successful CI and same-SHA evidence, immutable images, current production revision/image and traffic, protected configuration fingerprints, public health and control readiness where applicable, migration history and feature plan, exact migration receipts, serving/rollback compatibility, release classification and billing state. Missing or failing evidence still blocks the relevant action. Existing health/readiness failures, monitoring incidents, deployment drift or an explicit diagnosis request warrant investigation; they do not trigger routine human baseline attestations. This change adds no monitoring platform or orchestration.

The existing separately approved actions and exact `owner_action_approval=<action>:<SHA>` remain. MCP cutover still requires explicit `emergency_pilot_rollback_approved=true` while that recovery limitation applies. This is rollback approval, not evidence of a manual production test. Candidate acceptance remains mandatory and unchanged: deploy the isolated candidate, validate that candidate, then record its exact revision/image and all acceptance keys. Do not reuse old-SHA acceptance.

Build-only invocation (replace REVIEWED_SHA with the exact reviewed commit):

```sh
gh workflow run deploy-mcp.yml \
  --repo robleon-git/connectwise-mcp --ref phase1-hardening \
  -f action=build -f reviewed_sha=REVIEWED_SHA \
  -f owner_action_approval=build:REVIEWED_SHA
```

Functional acceptance belongs after deploying the changed surface. For MCP-affecting releases, retain authenticated inventory (39 reads / 0 writes, unchanged schemas), representative reads, USER C setup denial, USER A denial, cross-account isolation and concurrency checks on the candidate and new production revision. Successful traffic movement/public smoke alone is not functional acceptance. Portal-only releases validate the deployed portal and changed account/connection flows; they require no MCP owner login or read test. Control releases retain changed-endpoint/security checks and public health/readiness. No new automated QA authentication is introduced.

Migration selection, receipt validation, no-auto-rerun behavior, rollback eligibility and exact-SHA rules are unchanged. Billing defaults OFF. No migration, runtime authorization, tool inventory or customer data changes belong to this simplification.
