# Phase 0 repository review status

Current status: **Phase 0 live acceptance PASS**, completed 2026-10-10. This approved closeout includes the validated conditional-activation fix and final deployment/runbook/status/cost evidence. No Phase 1 functionality or deployment is included.

## Historical repository preparation — 2026-10-08

The preparation and validation details below describe the original repository checkpoint; current live evidence and approved deviations are recorded in [live status](PHASE0_LIVE_DEPLOYMENT_STATUS.md). No live Azure changes occurred during that original preparation.

## Implemented

- Minimal React/Vite portal shell; built-in SWA login/product APIs blocked.
- Separate Express control API with sanitized liveness/readiness, graceful drain, default-disabled product routes, production TLS and Key Vault service-credential handling.
- Checksummed/locked/transactional database migration ledger, bounded private bootstrap job and cleanup operator tool, separate bootstrap/runtime/migrator identities and roles; no customer schema.
- Non-root Linux AMD64 API packaging and initial new-resource manifests containing startup/liveness/readiness probes.
- Product-specific allowlisted Azure targets, read-only MCP baseline capture, safe public smoke checks, digest-based control build/candidate/promote/rollback, and build-once source-SHA artifact reuse.
- Unprivileged verification job separated from protected/manual OIDC delivery. No Phase 0 MCP deployment path.
- Approved resource placement and explicit pending live actions in [delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md).
- Mandatory manual [owner dogfood release gate](OWNER_DOGFOOD_SMOKE_TEST.md) for MCP-affecting releases; not claimed completed by automated probes.

## Validation

| Check | Result |
| --- | --- |
| npm run build:ui | PASS; tracked MCP card output unchanged |
| npm run build | PASS |
| npm run build:portal | PASS |
| npm run lint | PASS |
| Full suite with disposable real PostgreSQL | 20 files / 430 tests PASS; no skips |
| Linux AMD64 Node 26 regression parity | 20 files / 430 tests PASS, exit 0, with normal Vitest configuration and fresh disposable PostgreSQL |
| Focused real PostgreSQL integration | 2 tests PASS: non-superuser bootstrap, separate service roles, migrate/apply-once/concurrent/history/runtime restrictions |
| npm audit --omit=dev | 0 vulnerabilities |
| Full npm audit | PASS: 0 vulnerabilities; required release gate remains enabled |
| GitHub workflow actionlint | PASS |
| Linux AMD64 API image build | PASS, non-root node user, local test tag only |
| Final local container bootstrap/migration/health/ready/closed product routes | PASS; packaged bootstrap guard rejects implicit operation |
| Read-only production baseline and token-free smoke | PASS; existing image/mode/traffic/probes unchanged |
| git diff --check | PASS |

The inherited `vite-plugin-singlefile` → `micromatch` → `braces` chain has been removed. `scripts/build/ticket-card-inline.mjs` preserves the existing output byte-for-byte (generated module SHA-256 `106efe1b38c5360a899d1b70737087f9eaada33707daf0e54e816bd22780025b`). `npm run validate:ticket-card` checks a single HTML file, matching embedded module, no external script/stylesheet references, retained UI markers, and module syntax. Both verification workflows enforce it and full audit. Vite remains 8.2.2; no framework downgrade, audit-force, suppression or new dependency was used.

Bootstrap is packaged in the control image and rendered as a separate temporary manual job. An operator initializes only the two NONSECRET service-secret placeholders; the job uses system managed identity to read the bootstrap password and write the two named service passwords in memory. The management-plane helper never reads DB passwords and is not invoked by GitHub. It verifies narrowly scoped grants, starts/polls once, removes temporary grants, disables the bootstrap secret and deletes the job; failure to clean up blocks completion. Failure/timeout/broad-permission rejection and secret-safe CLI output are covered by focused tests. Partial Vault/SQL state and interrupted operator cleanup require explicit reconciliation, documented in the runbook.

The PostgreSQL 17 integration test runs bootstrap as a NON-superuser CREATEROLE infrastructure administrator, explicitly sets the temporary migrator role for default privileges, and verifies its role-use grant is revoked. Native creator ADMIN-only membership may remain as infrastructure administration authority; no application identity gets administrator access. Runtime cannot modify the ledger, create tables or assume migrator; migrator cannot create roles.

The dedicated GitHub OIDC identity's registry-scoped AcrPush is the approved V1 infrastructure constraint; no ABAC migration or existing pull-assignment changes. A reviewed SWA transport-token custom role definition is included. Exact future resource/permission/network/bootstrap/cleanup actions are in the delivery runbook. No live-resource commands were executed.

The local PostgreSQL and API test containers were removed. Ignored `.delivery/` contains only sanitized local evidence. No actual credential values were added. Existing uncommitted operator-helper work was preserved.

## Remaining gates before live work

1. Repository review; no commit/deploy before approval.
2. Full audit blocker resolved and private bootstrap packaging tested; retain these gates on every release.
3. Review exact new-resource commands/actions, database SKU/name/cost, the approved registry-scoped OIDC permissions and bounded private bootstrap actions.
4. Authorized Azure bootstrap/deployment/identity checks, new API/portal smoke and rollback exercise.
5. Authorized authenticated MCP discovery and applicable manual ChatGPT owner QA.

Existing canonical routing was inspected read-only in the earlier baseline pass. CNAME/environment/app observations and unresolved exact host/path mapping are documented; no guesses were applied to DNS or bindings. Existing MCP and Monotorr API images remain distinct in raw Azure metadata. Future MCP changes need a separate routing-aware delivery review; Phase 0 preserves the working service.

Phase 0 live acceptance has not passed: repository/local verification is not a substitute for deployed tests.

## Current production approval flow — 2026-10-10

Owner-approved delivery uses one human gate: Codex presents the exact live-changing action, receives owner approval, then triggers manual GitHub delivery. No required GitHub environment reviewers. Keep `connectwise-production`, branch-only policy, owner initiating/rerun checks, exact OIDC federation and scoped RBAC, immutable evidence, verification/audit gates and smoke/rollback. No automatic push deployment or MCP deployment extension. Historical protected-review milestones above remain historical records. Codex approval is procedural; GitHub does not independently validate the conversation approval.
