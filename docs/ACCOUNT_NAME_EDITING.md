# Account display name

The existing Account section offers an inline **Account name → Edit → Save / Cancel** interaction. A successful save uses the server-confirmed name and refreshes authoritative account status without signing out. Cancel makes no request; duplicate saves are blocked, and unmount cancels the browser request. An interrupted request may already have committed, so a fresh status fetch remains authoritative.

`POST /connectwise/v1/account/name` accepts only `{ "name": "Example MSP" }` from the trusted portal origin with an authenticated owner session. Request account/user selectors are rejected. The update rechecks active user, account and owner membership using the server-derived session context. Responses contain only the saved account name; errors never expose database details.

Names are trimmed, nonempty and at most 120 UTF-16 code units. Control, format and line/paragraph separator characters are rejected. Ordinary Unicode names and punctuation are allowed; React escapes displayed values. Signup still seeds the name from the Microsoft name claim and subsequent sign-ins never overwrite the account label.

The sole data update is `accounts.name`. Account IDs, identity mappings, sessions, entitlements, billing ownership, ConnectWise configuration and credential references remain unchanged. Name editing is independent of entitlement status and never changes MCP access.

## Required schema and delivery

The existing control role lacks account-update privileges. Core migration `0008_account_name_edit` grants **only** `UPDATE(name)` on `public.accounts` to `cw_control`. It adds no tables or columns and grants no account status/ID updates, delete, entitlement writes or MCP writes. Existing SQL/checksums are unchanged. Billing migrations 0006/0007 remain deferred with billing OFF.

This feature cannot be released by portal publication alone: the endpoint and column grant must be delivered first. Adding a required core manifest entry changes shared startup readiness, so the conservative release classification is MCP-affecting even though MCP tools and authorization logic are unchanged. Use fresh same-SHA build/provenance and candidate acceptance under the existing delivery guards.

Before approving a live migration, review the ordering and rollback path: older artifacts reject unknown migration history on restart. A compatible rollback artifact must recognize migration 0008; retaining the previous image alone does not prove startup compatibility. No delivery guard or readiness exception is introduced here. This repository-only implementation does not apply the migration, deploy applications, or enable billing.
