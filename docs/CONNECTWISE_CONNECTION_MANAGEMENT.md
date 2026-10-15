# ConnectWise connection management

The existing portal section displays the saved server URL (including the supported API path) and company, with Test connection, Edit, and Remove actions. The header is Monotorr; the tagline is unchanged.

## Control API contract

All operations are POSTs beneath `/connectwise/v1/connectwise/connection`, use the existing authenticated Microsoft portal session and exact portal Origin, and derive account authority server-side. Query selectors and account/connection headers are rejected. Bodies are strict JSON, bounded to 8 KiB.

- `/test`: empty object; entitlement and ownership checked before reading the exact saved credential versions and making the existing bounded, TLS-verified ConnectWise validation GET. Does not save, rotate, or change connection/entitlement metadata.
- `/edit`: server URL and company, with either both replacement keys or neither. Missing keys reuse the saved credentials only on the server. Validates before writing a separate credential pair and before atomically replacing the connection row. Checks access before credential access, after validation, and before activation. Partial keys or foreign authority are rejected.
- `/disconnect`: empty object; active account ownership required, including when entitlement has expired. Marks the connection `cleanup_required` and clears both active references before vault cleanup. The retained row supports existing cleanup/reconnect behavior. Account, entitlements, billing, and identity bindings are untouched.

All lifecycle operations share the existing per-account setup lock. Replacement uses existing INSERT/DELETE grants within one transaction; the original row remains visible until commit. Failed validation, persistence, or activation preserves the original. An uncertain commit is checked against the current active ID before any credential cleanup. If that read is unavailable, credentials are preserved for operator review rather than risking deletion of an active pair.

Secret cleanup is best effort after retirement. Failure emits only the existing sanitized cleanup event. Retired credentials are never selected for later MCP calls: authorization resolves the active row for each request, with no connection/authorization cache. Already-authorized in-flight requests are not retroactively recalled. A process crash during vault persistence can leave an unreferenced secret pair; cleanup events and vault metadata need operator review, and secrets must never be removed solely on an uncertain commit outcome.

## Portal

Edit prepopulates only safe server/company fields. Both password fields start empty and are cleared on submit. The original saved summary stays visible until authoritative status refresh. Test has inline success or sanitized failure; removal requires inline confirmation with Cancel/Disconnect. Expired access disables Test/Edit while allowing removal. Management availability follows the existing connection-setup feature gate. No new billing or account-linking behavior is introduced.

## Delivery boundary

No live resource or permission change is part of this implementation. A future deployment must separately verify the control application's narrowly scoped ability to GET the existing exact-version customer credentials, in addition to its existing write/delete capabilities. Do not assume the deployed identity already has read permission and do not grant infrastructure-vault access. Without customer-vault read, Test and credential-reusing Edit fail closed; supplying replacement keys does not require reading old values.

There is no new migration, database grant, Stripe change, or MCP tool. Billing stays OFF. Release impact must be recomputed from the reviewed commit; this change preserves all 39 MCP executable modules and their protected inputs and uses the existing control-only delivery guards. Live validation/deployment needs separate approval.

## Evidence

Focused HTTP/service/UI tests and disposable PostgreSQL 18 fixtures cover ownership, nonmutating tests, credential reuse/replacement, persistence and activation failures, concurrent operations, revocation checkpoints, lost commit acknowledgements, soft disconnect and preservation of account/billing/binding data. Isolated browser QA covers confirmations, cancellation, double submission, errors, cleared fields, refreshed states and desktop/mobile layout. Browser API responses use synthetic fixtures; this is not a live customer credential test. Ignored local evidence is in `.delivery/connection-management/`.
