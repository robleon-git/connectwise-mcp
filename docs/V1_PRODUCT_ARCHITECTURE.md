# Monotorr ConnectWise MCP — V1 Product Architecture

Status: Approved architecture baseline\
Product: Monotorr ConnectWise MCP\
Scope: V1 commercial SaaS\
Primary principle: Keep the product simple. Build only what is required to let a customer sign up, connect one ConnectWise Manage instance, obtain valid access, connect an AI client, and use the existing read-only MCP surface.

---

# 1. Product Definition

Monotorr ConnectWise MCP is a commercial multi-customer SaaS that gives authenticated AI clients read-only access to each customer's ConnectWise Manage instance.

The product is intentionally not a ConnectWise management console.

Customers configure Monotorr once, connect their AI client, and then interact with ConnectWise data through ChatGPT, Claude, Copilot, or another compatible MCP client.

The core product promise is:

> Your ConnectWise data. Your AI.

The core V1 execution path is:

Authenticated identity
→ customer account
→ valid entitlement
→ that account's single active ConnectWise connection
→ securely load that connection's credentials
→ execute authorized read-only MCP tools

This path is the architectural center of V1.

---

# 2. V1 Product Principles

## 2.1 One account, one ConnectWise connection

Each customer account supports at most one active ConnectWise Manage connection.

V1 does not support:

- multiple ConnectWise connections per account
- sub-tenants
- provider hierarchies
- organization switching
- connection switching
- customer tenant selectors
- multiple PSA systems

The database may be designed so future expansion is possible, but the V1 product and APIs must enforce one active ConnectWise connection per customer account.

## 2.2 Multi-customer SaaS without customer-facing multi-tenancy

Monotorr itself is multi-customer SaaS.

Customers must be isolated from one another.

However, a customer does not need to understand or manage "tenants."

The portal should feel like:

My account
→ My ConnectWise
→ My AI connection

not:

Provider
→ Organization
→ Tenant
→ Connection
→ Environment

## 2.3 Read-only by design

V1 is read-only.

The existing 39 ConnectWise MCP tools form the initial data surface.

No ConnectWise tool may create, modify, update, delete, close, approve, remediate, or otherwise change ConnectWise data.

No general-purpose automation engine is included.

No remediation feature is included.

Write functionality is explicitly outside V1.

## 2.4 The portal is a setup console

The Monotorr portal exists to manage the product relationship and connection.

It does not reproduce ConnectWise.

The portal handles:

- signup/login
- entitlement
- onboarding
- ConnectWise credential configuration
- connection testing
- connection status
- permissions/readiness checks
- AI client setup
- readiness assessment guidance
- billing
- account management
- disconnect/reconnect
- support/admin visibility

Operational ConnectWise data such as tickets, companies, contacts, agreements, projects, invoices, or time entries is primarily accessed through the AI client using MCP.

## 2.5 Do not build ahead of validated need

Do not add abstractions, workflows, frameworks, helper services, or user-facing options solely because they may be useful later.

Prefer the smallest implementation that satisfies V1.

When uncertain, ask:

> Is this necessary for a customer to sign up, obtain access, connect ConnectWise, connect their AI client, and get value?

If the answer is no, it is probably not V1.

---

# 3. Existing MCP Foundation

The current MCP implementation is already operational.

The production-connected MCP surface contains exactly 39 read-only tools.

These tools include access to:

- tickets
- ticket notes
- companies
- contacts
- projects
- project tickets
- time entries
- members
- configurations
- boards
- priorities
- statuses
- activities
- catalog items
- catalog categories
- catalog subcategories
- manufacturers
- agreements
- agreement additions
- invoices
- opportunities
- opportunity forecasts
- opportunity notes
- sales stages
- connection testing

The existing read-only tool surface should be preserved.

Higher-value helper tools, reporting functions, guided experiences, or power prompts should be added only after real customer/query usage demonstrates where the raw surface falls short.

---

# 4. Identity Model

Identity and entitlement are separate concepts.

## 4.1 Identity

Identity answers:

> Who is this person?

V1 uses Microsoft business-account authentication.

Reuse/adapt the proven Monotorr authentication and browser-session patterns where appropriate.

The system should maintain an internal Monotorr user record rather than treating an external identity token as the application database.

A user belongs to a customer account.

Initially most customer accounts may contain only one owner.

The data model may support memberships so future team access is possible, but V1 does not need:

- invitations
- ownership transfer
- organization switching
- team administration UX
- multi-account selection

## 4.2 MCP identity

MCP authentication remains separate from browser portal authentication.

The existing Descope OAuth architecture remains the MCP authorization layer.

The MCP request must resolve the authenticated MCP principal to an internal Monotorr user/account.

Do not assume identity equivalence based only on matching email addresses.

Maintain an explicit identity mapping.

---

# 5. Customer Account Model

A customer account is the primary isolation boundary.

Conceptually:

User
→ Customer Account
→ Entitlement
→ ConnectWise Connection

A customer account has:

- internal account ID
- account name
- status
- created timestamp
- current entitlement
- at most one active ConnectWise connection
- onboarding state

All customer-owned records must be scoped to the account ID.

Every backend request that accesses customer-specific configuration must resolve and enforce the account boundary.

No caller may supply an arbitrary account ID or connection ID and gain access merely because the record exists.

Ownership must be verified server-side.

---

# 6. Entitlement Model

Entitlement answers:

> Why does this account currently have access to Monotorr?

Entitlement is not a user type.

V1 supports these entitlement sources:

- `trial`
- `web_paid`
- `substack`
- `comp`

Recommended conceptual fields:

- account_id
- source
- status
- starts_at
- ends_at
- external_reference where required
- created_at
- updated_at

Possible statuses:

- active
- expired
- canceled
- suspended

The exact implementation may evolve, but identity must remain separate from entitlement.

## 6.1 Fail-closed rule

If an account does not have a valid active entitlement:

- MCP access must fail closed.
- Customer ConnectWise credentials must not be loaded.
- No ConnectWise API request may be made.

Entitlement must be checked before customer credential resolution.

---

# 7. Acquisition Source

Acquisition should be stored separately from entitlement.

Examples:

- web
- substack
- referral
- manual
- partner

An account might originally arrive from the web, start a trial, later claim a Substack entitlement, and later become directly paid.

That must remain one account.

Do not encode acquisition history into the current entitlement field.

---

# 8. Web Signup Flow

The normal public web flow should remain simple.

Customer visits Monotorr
→ clicks Sign Up
→ authenticates with Microsoft business account
→ Monotorr creates user/account if required
→ Monotorr grants 30-day trial entitlement
→ onboarding begins
→ customer configures ConnectWise
→ connection is validated
→ customer connects AI client
→ readiness experience / quick win
→ continued usage
→ trial eventually requires paid entitlement

The standard signup flow should not ask:

> Are you a Substack subscriber?

Substack should not complicate normal web onboarding.

---

# 9. Substack Claim Flow

Substack users have a separate entry point:

`monotorr.com/substack`

The purpose is to prevent irrelevant subscription choices from cluttering the normal signup flow.

Flow:

Customer visits `/substack`
→ clicks Claim Your Subscription
→ signs in or creates a Monotorr identity
→ enters/verifies the Substack email if necessary
→ Monotorr validates an eligible active Substack subscription
→ account receives `substack` entitlement
→ onboarding continues normally

A Substack user is not a different user type.

A Substack claim changes entitlement, not identity.

## 9.1 Existing account claiming Substack

An existing Monotorr customer may later visit `/substack`.

The system should:

- authenticate the existing user
- validate the Substack subscription
- attach/update entitlement on the same customer account
- avoid creating a duplicate Monotorr account

Billing conflicts must be handled intentionally so a user is not accidentally charged twice.

---

# 10. Complimentary Access

The product must support manually granted free access.

This is not the same as a Stripe coupon.

Use:

`source = comp`

Complimentary entitlement provisioning remains part of the commercial lifecycle. Its restricted operator mechanism must be explicitly decided separately; the Basic Internal Admin Console cannot grant, revoke or edit entitlements. Any later console management capability requires separate approval. Provisioning must support:

- indefinitely
- optionally until a selected expiration date

This supports:

- beta users
- partners
- friends
- strategic customers
- internal testing
- promotional access

Complimentary access should not require creating a fake Stripe subscription.

---

# 11. Stripe Billing

Stripe is part of V1.

Stripe implementation may occur after the core ConnectWise connection flow is operational, but launch requires paid customer lifecycle support.

Stripe primarily backs:

`web_paid`

Responsibilities include:

- checkout
- subscription creation
- subscription status
- renewal
- cancellation
- failed payment handling
- entitlement updates resulting from billing state

Billing state must not be treated as authentication state.

An account can have access through another entitlement source even if no Stripe subscription exists.

Examples:

- Substack
- complimentary access
- active trial

Promo/coupon support may be implemented through Stripe where appropriate.

Complimentary internal grants should use the Monotorr entitlement system instead.

---

# 12. ConnectWise Integration Model

Monotorr owns one registered ConnectWise integration Client ID.

The Monotorr Client ID is global application configuration.

Customers do not create or supply their own ConnectWise Client ID.

Each customer supplies:

- ConnectWise server URL
- Company ID
- Public API key
- Private API key

Authentication request conceptually uses:

Monotorr ConnectWise Client ID
+
customer Company ID
+
customer public API key
+
customer private API key

The registered Monotorr Client ID must never be confused with customer-specific credentials.

---

# 13. ConnectWise Credential Storage

Customer ConnectWise credentials must not be stored in normal application tables in plaintext.

Sensitive values:

- public API key
- private API key

must use secure secret storage.

The application database should store connection metadata and secure references to secrets rather than secret values where practical.

Credential retrieval must be scoped to the authenticated customer's account.

No cross-account cache contamination is permitted.

Credential values must never appear in:

- logs
- diagnostics
- browser responses after save
- admin UI
- error messages
- audit records

The private key must never be retrievable through a normal portal API after it is saved.

Credential replacement should overwrite/rotate the securely stored customer credential.

---

# 14. ConnectWise Connection Record

Recommended conceptual connection fields:

- id
- account_id
- server_url
- company_id
- credential_reference
- status
- last_tested_at
- last_success_at
- last_failure_at
- sanitized_failure_code
- created_at
- updated_at
- disconnected_at

Only one active connection may exist per account.

Suggested statuses:

- not_configured
- validating
- connected
- error
- disconnected

Avoid unnecessary state complexity.

---

# 15. Connection Setup Flow

Customer onboarding should make ConnectWise configuration straightforward.

Portal asks for:

- ConnectWise URL
- Company ID
- Public API key
- Private API key

Monotorr supplies the registered global Client ID automatically.

After submission:

1. Validate input format.
2. Store credentials securely.
3. Run a safe read-only connection test.
4. Return sanitized status.
5. If successful, mark connection `connected`.
6. Proceed to permissions/readiness validation.

Never expose raw ConnectWise API responses containing potentially sensitive information.

---

# 16. Connection Validation

Connection diagnostics should distinguish useful failure classes when possible.

Examples:

- invalid URL
- TLS failure
- unreachable host
- authentication failure
- incorrect Company ID
- invalid API keys
- invalid/missing ConnectWise Client ID
- insufficient permissions
- connection successful

Diagnostics must remain sanitized.

A successful authentication test does not necessarily prove all 39 tools are permitted.

---

# 17. Read-Permission Validation

V1 should provide a bounded read-only validation that helps the customer understand whether their ConnectWise API member has adequate permissions.

This validation must:

- make only read requests
- use representative endpoints
- never attempt writes
- identify likely missing permissions
- provide setup guidance

Avoid testing all possible endpoints unless there is a demonstrated reason.

The purpose is customer onboarding and support, not exhaustive certification of every ConnectWise permission.

---

# 18. MCP Request Authorization

Every hosted MCP request must follow this order:

1. Validate MCP OAuth token.
2. Resolve MCP principal to Monotorr user.
3. Resolve user to customer account.
4. Validate active entitlement.
5. Resolve that account's single active ConnectWise connection.
6. Load only that connection's credentials.
7. Instantiate/use the read-only ConnectWise client.
8. Execute the requested authorized tool.
9. Return result.

Failure at any step must fail closed.

No ConnectWise credential should be loaded before authorization and entitlement resolution are complete.

---

# 19. Tenant Isolation

Tenant isolation is mandatory even though the customer UI is not multi-tenant.

Customer A must never:

- retrieve Customer B's connection metadata
- resolve Customer B's credential reference
- load Customer B's secret
- execute MCP calls using Customer B's configuration
- see Customer B's diagnostic state
- affect Customer B's entitlement
- see Customer B's onboarding state

Tests must explicitly attempt cross-account access.

IDs alone must not authorize access.

All queries involving customer-owned records must include account scope or equivalent ownership enforcement.

---

# 20. ConnectWise URL Safety

Because customers provide their ConnectWise URL, the service must validate outbound targets.

Minimum requirements:

- HTTPS required for hosted production connections
- reject malformed URLs
- reject embedded credentials
- prevent access to cloud metadata endpoints
- prevent unintended localhost/private infrastructure access where appropriate
- carefully control redirects
- preserve TLS certificate verification

Do not weaken TLS to accommodate incorrectly configured customer systems.

---

# 21. Portal Information Architecture

Keep the customer portal intentionally small.

Possible V1 structure:

## Home

Shows:

- account status
- entitlement status
- ConnectWise connection status
- onboarding progress
- next recommended action

## ConnectWise

Shows:

- connection configuration
- connected/error/disconnected status
- test connection
- replace credentials
- permission/readiness status
- disconnect/reconnect

Never display stored private API key.

## AI Setup

Shows instructions for connecting:

- ChatGPT
- Claude
- other supported MCP-compatible clients

May include copyable MCP endpoint/setup instructions where appropriate.

## Billing

Shows:

- current access source
- trial expiration
- paid subscription state
- Stripe management actions when relevant

Substack and comp accounts should not be forced into Stripe UI.

## Account

Shows:

- account/profile basics
- logout
- appropriate account lifecycle actions

Avoid adding navigation sections unless V1 requires them.

---

# 22. Onboarding State

Track onboarding separately from entitlement.

Possible checkpoints:

- account_created
- connectwise_config_started
- connectwise_connected
- permissions_checked
- readiness_completed
- ai_client_setup_started
- ai_client_connected
- onboarding_completed

Do not make onboarding overly rigid.

The goal is to identify the customer's next useful action.

---

# 23. Readiness Assessment

V1 includes one structured ConnectWise readiness experience intended to create an immediate "wow" moment.

The readiness assessment should use the existing read-only MCP surface.

It should:

- inspect a bounded set of meaningful ConnectWise areas
- produce consistent structured output
- identify a small number of useful observations
- encourage follow-up conversation through the AI client
- avoid overwhelming the user

The initial V1 goal is one excellent guided assessment.

Do not build a general-purpose assessment engine until additional guided experiences are proven necessary.

---

# 24. Guided Experiences / Power Prompts

The existing 39 raw tools are the initial product surface.

Monotorr may provide curated instructions, power prompts, or guided experiences that help users ask useful questions.

Examples might eventually include:

- ConnectWise readiness
- client service summary
- ticket-volume analysis
- labor consumption
- agreement profitability
- project visibility

Do not implement these simply because they are possible.

First explore the raw tool surface.

Repeated query friction should determine which helpers become product features.

---

# 25. Onboarding Email Sequence

Every newly activated account should enter an onboarding sequence regardless of entitlement source.

Trigger conceptually on:

`first_access_granted`

This includes:

- trial
- web_paid
- substack
- comp

The sequence should focus on activation rather than billing.

Suggested sequence themes:

1. Welcome / connect ConnectWise.
2. Run your readiness assessment.
3. Useful questions to ask your ConnectWise data.
4. Show an additional high-value use case.
5. Help if setup is incomplete.

Reuse/adapt Monotorr's existing Resend patterns where useful.

Exact copy and timing are a separate product/content task.

---

# 26. Basic Internal Admin Console — required for V1 launch

The **November 17, 2026** launch requires a small internal operations console for onboarding, connection health, MCP usage/errors and Readiness Assessment usage. It is visibility only, not a customer dashboard, analytics product, billing console or ConnectWise administration interface. This approved scope supersedes the earlier broader support-console plan.

Reuse the existing portal and control API with a distinct login-protected admin route area, one customer table and an optional expandable row/small detail screen. Do not introduce another dashboard platform, reporting stack or analytics warehouse.

Customer overview shows:

- customer/account name (a tenant label does not introduce a provider hierarchy)
- onboarding and ConnectWise connection state
- last successful connection and last MCP activity
- MCP tool calls in the last seven days
- failed MCP calls and sanitized error categories
- Readiness Assessment execution count

Customer detail shows stored connection health, recently used tools, per-tool usage counts, recent sanitized error categories and Readiness Assessment execution history. Missing/stale observations must be labeled honestly; opening the console never triggers a ConnectWise read or tool execution.

Use only narrow server-side operational-summary APIs: customer list, customer operational detail and recent sanitized telemetry summaries. Select targets only from authorized customer records and bounded filters; a customer ID alone never authorizes access. Use explicit response allowlists, pagination and bounded time windows. No arbitrary record/table lookup, database browser, SQL, log explorer, credential retrieval, impersonation or admin MCP execution API.

Section 37 remains mandatory: a separately designated internal admin identity and server-side admin authorization, distinct from customer sessions/account membership. Customer sessions are denied on admin routes; admin-only identities are not automatically provisioned customer accounts, entitlements or MCP access. The product owner's ordinary identity receives no special privileges. No email/domain/ownership exception.

Routine server-side telemetry is independent of console activity. Store only trusted internal account context (nullable for unattributed authentication failures), allowlisted event/tool identifiers, server timestamps, bounded duration and sanitized categories. Never store conversation content, ticket bodies/notes, agreement financial payloads, invoice payloads, raw ConnectWise responses, API keys, OAuth tokens, cookies or Authorization headers. No new path to customer operational data or secret storage is permitted.

V1 console exclusions: billing/subscription administration, entitlement editing or comp grant/revoke, customer impersonation, customer-facing/advanced analytics, alerts/notifications, full audit-log exploration, support ticketing, tool execution, remediation/write actions, ConnectWise operational browsing, arbitrary SQL/database access and a large dashboard framework. Customer Stripe functionality and the four entitlement sources remain in V1; they do not create console management permissions.

Acceptance requires secure explicit admin login, denial for customer identities, an accurate customer/connection table, per-customer last MCP activity and per-account/tool counts, sanitized failures, measurable readiness executions, payload/credential-free telemetry, automated account/admin boundary tests and a deployed smoke on existing lightweight infrastructure. Detailed telemetry retention, delivery slices and the launch checklist live in [the implementation plan](V1_IMPLEMENTATION_PLAN.md).

---

# 27. Disconnect / Reconnect

Disconnect should:

- mark the connection inactive/disconnected
- prevent MCP execution using that connection
- prevent credentials from being loaded for new requests
- preserve appropriate non-secret audit/history records
- handle secret retention/deletion according to the final credential lifecycle policy

Reconnect should allow the customer to securely supply/replace credentials and rerun validation.

Do not overcomplicate lifecycle state.

---

# 28. Audit Events

Store sanitized operational events where useful.

Examples:

- account created
- entitlement granted
- entitlement changed
- ConnectWise configured
- connection test passed
- connection test failed
- credentials replaced
- connection disconnected
- connection reconnected
- explicitly authorized entitlement lifecycle change (not an admin-console action)

Audit records must not contain secrets. The Basic Internal Admin Console is not a full audit-log explorer.

Launch also requires account-scoped operational telemetry for MCP execution success/failure, tool ID, server timestamp, bounded duration, authentication/connection failure category and Readiness Assessment execution. Account IDs come only from verified server context; failed authentication without a trusted mapping remains unattributed. Telemetry never causes credential loading or ConnectWise requests on denial.

Use the existing product PostgreSQL/control plane with bounded event storage and daily usage aggregates. V1 policy: retain detailed operational events for 30 days and daily account/tool/outcome counts for 90 days; expire both automatically with bounded maintenance. Aggregates contain no payloads or raw error text. Account deletion must address both stores under the approved lifecycle policy. This does not change infrastructure backup retention or create a customer analytics feature. See Phase 6 in the implementation plan for field, counting and privacy rules.

---

# 29. Reuse From Monotorr 365

Monotorr 365 is a reference architecture, not a shared runtime.

Reuse/adapt useful patterns including:

- Microsoft login
- browser sessions
- customer/account scoping
- migration framework
- portal layout
- status components
- configuration UX
- disconnect/reconnect lifecycle
- Stripe integration
- Resend integration
- deployment patterns
- admin/support patterns

Do not copy Microsoft-365-specific concepts into the ConnectWise product.

Exclude:

- Graph application permissions
- Microsoft administrative consent
- GDAP
- M365 collectors
- assessment pack machinery unless directly justified
- Exchange/Defender/Intune logic
- Microsoft tenant selector UX
- provider/sub-tenant hierarchy

The products remain separate codebases and separate operational boundaries.

---

# 30. Deployment Boundaries

The ConnectWise product remains operationally independent from Monotorr 365.

Expected logical components:

Customer Portal
→ Control Plane API
→ ConnectWise product database
→ secure credential store

AI Client
→ Descope OAuth
→ MCP server
→ account/entitlement/connection resolution
→ secure credential store
→ ConnectWise API

Existing public MCP endpoint:

`https://api.monotorr.com/mcp`

must remain stable unless explicitly changed.

Avoid premature infrastructure splitting.

Separate services should exist only where security, deployment, or responsibility clearly benefits.

---

# 31. Suggested Core Data Model

This is conceptual, not final SQL.

## users

Represents Monotorr identities.

## accounts

Represents customer isolation boundary.

## account_memberships

Links user to account.

V1 may contain only one owner per account but should not hard-code user identity directly into every customer-owned table.

## external_identities

Maps Entra/Descope identities to internal users where required.

## entitlements

Tracks:

- trial
- web_paid
- substack
- comp

## connectwise_connections

One active connection per account.

Stores only non-secret configuration plus credential references.

## onboarding_state

Tracks onboarding progress.

## subscriptions

Stores Stripe linkage/status when relevant.

## audit_events

Stores sanitized account/application events; no full audit-log exploration in the V1 console.

## operational_events / daily operational counts (planned)

Minimal account-scoped metadata and bounded per-day account/tool/outcome aggregates for required internal operations. Use the existing product database, not ConnectWise payload storage or an analytics warehouse. These are conceptual planning records, not migrations or claims of implementation.

Additional tables should require a demonstrated V1 need.

---

# 32. Explicit V1 Non-Goals

Do not build these without a separately approved scope change:

- multiple ConnectWise instances per customer
- sub-tenants
- organization switching
- team invitations
- ownership transfer
- customer role-management UX
- provider/MSP hierarchy
- write tools
- ConnectWise ticket updates
- remediation
- workflow automation
- general-purpose script execution
- arbitrary PowerShell execution
- replacement ConnectWise UI
- embedded reporting dashboard for ConnectWise data
- generalized assessment framework
- generalized rules engine
- multiple PSA support
- reseller model
- usage-based billing
- complex plan matrix
- enterprise SSO administration
- impersonation
- customer-created ConnectWise Client IDs

If implementation work begins to require any of these, stop and request explicit approval.

---

# 33. Security Invariants

The following are non-negotiable:

1. Customer private keys never appear in logs or UI.
2. Entitlement is checked before ConnectWise credentials are loaded.
3. Customer account ownership is checked server-side.
4. Cross-account configuration access fails closed.
5. ConnectWise access remains read-only.
6. TLS verification remains enabled.
7. MCP caller credentials are never forwarded to ConnectWise.
8. ConnectWise credentials are never supplied by the MCP caller.
9. Monotorr's registered ConnectWise Client ID is application configuration.
10. Every customer request resolves its own account-specific ConnectWise configuration.
11. No global customer ConnectWise configuration may be reused in hosted SaaS operation.
12. Cache keys, if introduced, must include the customer/account/connection boundary.
13. Diagnostic output must remain sanitized.

---

# 34. Initial Build Sequence

Implementation should proceed in small vertical slices.

## Phase 1 — Account foundation

Implement:

- user identity
- customer account
- membership
- entitlement model
- browser session
- basic portal shell

Acceptance:

A customer can authenticate and resolve to exactly one account with a known entitlement state.

## Phase 2 — Customer ConnectWise connection

Implement:

- connection record
- secure credential storage
- connection setup UI
- connection validation
- status display
- disconnect/reconnect

Acceptance:

Two test customer accounts can independently configure different ConnectWise credentials without any possibility of cross-resolution.

## Phase 3 — Tenant-aware MCP resolution

Replace the current global hosted ConnectWise configuration with:

MCP principal
→ internal user
→ account
→ entitlement
→ single active connection
→ account-specific credential loading

Acceptance:

Two customer identities connected to different ConnectWise instances can use the same MCP endpoint and each sees only its own ConnectWise data.

Cross-account access tests must fail.

## Phase 4 — Onboarding and readiness

Implement:

- onboarding state
- setup guidance
- permission/read diagnostics
- readiness assessment
- AI-client setup instructions

Acceptance:

A new customer can go from account creation to first meaningful ConnectWise result without operator intervention.

## Phase 5 — Commercial lifecycle

Implement:

- Stripe
- 30-day trial
- paid entitlement
- Substack claim
- complimentary entitlement
- entitlement enforcement

Acceptance:

Each entitlement path correctly grants/revokes MCP access without changing identity or ConnectWise configuration.

## Phase 6 — Basic Internal Admin Console

Implement only:

- separate internal admin authentication and server-side authorization
- tenant-aware operational telemetry and bounded retention/aggregates
- customer overview/detail APIs and lightweight internal UI
- stored connection/onboarding state, sanitized failures and per-account/tool counts
- Readiness Assessment execution counts/history

Account-aware MCP supplies trusted per-customer execution events; the readiness slice supplies an observable assessment execution event. Do not delay current customer slices while the separate admin identity is still undesignated.

Acceptance:

An explicitly authorized internal administrator can see only permitted operational metadata. Customer sessions are denied, the normal product owner has zero admin privilege, and admin-only identities receive no customer MCP access. No billing/entitlement editing, complimentary-access controls, impersonation or tool execution is included.

## Phase 7 — Launch hardening

Implement:

- onboarding email sequence
- documentation
- audit coverage
- CI/deployment validation
- tenant isolation tests
- operational monitoring
- support workflows

Acceptance:

Product is ready for external customers.

---

# 35. Definition of V1 Complete

V1 is complete when a new external customer can:

1. Visit Monotorr.
2. Sign up with a Microsoft business account.
3. Receive a valid entitlement.
4. Enter one ConnectWise connection.
5. Successfully validate that connection.
6. Receive useful permission/setup guidance.
7. Connect ChatGPT or another supported MCP client.
8. Authenticate through Monotorr.
9. Use the 39 read-only ConnectWise tools against only their own instance.
10. Run the readiness experience.
11. Manage their subscription/access.
12. Return later and continue using the product without operator assistance.

And when the required Basic Internal Admin Console lets a separately authorized internal administrator:

1. Securely log in without customer-derived privileges.
2. View registered customers, onboarding and stored connection health/last success.
3. See last MCP activity and seven-day per-customer/tool counts.
4. View only sanitized connection/tool error categories.
5. See Readiness Assessment counts/history.
6. Operate within tested customer/admin isolation and retention/privacy boundaries.

Customer identities cannot access admin routes. The console cannot retrieve keys, inspect operational payloads, impersonate a customer, execute tools, administer subscriptions or edit entitlements. Complimentary entitlement remains a commercial capability; its separate provisioning decision does not expand console scope.

**Basic Internal Admin Console — REQUIRED FOR LAUNCH (November 17, 2026).** The canonical checklist is in [the implementation plan](V1_IMPLEMENTATION_PLAN.md#november-17-2026-launch-checklist).
---

# 36. Architecture Decision Rule

When implementation choices are unclear, prefer the solution that preserves:

- one account
- one connection
- one entitlement decision
- one customer isolation boundary
- one read-only MCP surface

Do not generalize before a real requirement exists.

The goal of V1 is not to build a ConnectWise platform.

The goal is to build the simplest trustworthy commercial connection between a customer's ConnectWise Manage data and their preferred AI client.

---

# 37. Admin Identity Separation

The product owner's normal Monotorr account must operate as a standard customer account.

It must:
- belong to a normal customer account
- use a normal entitlement
- use one normal ConnectWise connection
- be subject to the same MCP authorization, entitlement, and isolation rules as every other customer
- have no implicit or hidden administrative privileges

System administration must use a separate super-admin identity.

The super-admin identity:
- is not a customer account
- does not inherit customer entitlements
- does not use customer MCP access by default
- is used only for support and system administration
- may view only the administrative data explicitly permitted by the admin console
- must never reveal customer private API keys or bypass customer isolation rules

Do not grant administrative capability based on a customer email address, ownership flag, or "special case" account logic.

Customer and super-admin authorization paths must remain distinct.

```text
rob@monotorr.com
→ normal customer
→ normal customer account
→ normal entitlement
→ normal ConnectWise connection
→ normal MCP access

separate-admin-identity
→ super-admin
→ admin console only
→ operational visibility / sanitized diagnostic summaries only
```

---

# 38. ConnectWise Cloud and Customer-Hosted Support

V1 must support both ConnectWise Manage Cloud-hosted instances and customer-hosted/on-premise ConnectWise Manage instances.

Each customer supplies their own ConnectWise server URL.

The implementation must not hard-code Monotorr's current test hostname, assume ConnectWise Cloud hostname conventions, or create separate product flows for cloud versus on-premise.

Both deployment models use the same customer setup flow:

```text
ConnectWise URL
→ Company ID
→ Public API Key
→ Private API Key
→ Test Connection
→ Validate read access
→ Connected
```

Monotorr supplies the global registered ConnectWise Client ID.

Before public launch, representative read operations must be validated against at least:

- one ConnectWise Cloud instance
- one customer-hosted/on-premise instance

---

# 39. Approved Production Delivery Boundaries

New ConnectWise SaaS-specific production resources belong in `monotorr-connectwise-prod-rg` where practical, including a dedicated ConnectWise PostgreSQL server/database and new control-plane resources.

Reuse the existing `monotorr-prod-aca-env`, `monotorrdevacr6689`, and ConnectWise product vault `cw-mcp-kv`. Preserve the working ConnectWise MCP Container App in its current resource group. Do not move, recreate, or duplicate working infrastructure merely for resource-group separation. Shared infrastructure does not permit shared application identities, customer data, secrets, or configuration with Monotorr 365.

Resource-group separation is an operational/lifecycle boundary, not a substitute for separate managed identities, least-privilege RBAC, database ownership, secret isolation, customer isolation, or application configuration.

Use manually triggered GitHub-to-Azure workload identity/OIDC deployment authentication with least privilege; no ACR admin credentials or subscription-wide Owner role. Azure-generated portal/control API hostnames are permitted for Phase 0. Select permanent names before Phase 1 authentication redirects and browser-session configuration are finalized.

During Phase 0, preserve the existing `https://api.monotorr.com/mcp` DNS, custom-domain bindings, routing, Descope configuration, path, revision mode, traffic, and probes. Capture the baseline and smoke-test it. Configure proper startup/readiness/liveness only for the new control API. Introduce MCP candidate/promotion changes only when an actual reviewed MCP application release requires them.

Every release affecting MCP authentication, identity/account resolution, entitlement enforcement, ConnectWise credential/connection resolution, client construction, tool registration, or execution requires a manual owner dogfood smoke: Rob's ordinary customer identity uses production ChatGPT through the production MCP endpoint to execute a known read against Rob's own ConnectWise instance, without administrative privileges. See [Owner dogfood release gate](OWNER_DOGFOOD_SMOKE_TEST.md).


## Approved Phase 1 customer-facing hostname decision

Customer portal: `https://portal.monotorr.com`. Control-plane API: existing `https://api.monotorr.com`, under a dedicated ConnectWise path namespace separate from existing Monotorr routes. Preserve `https://api.monotorr.com/mcp` unchanged. Do not introduce another control API hostname without a demonstrated technical limitation.

The proposed namespace, exact browser redirect, CORS/session contract and resolved portal placement are recorded in [Slice 1 auth design](PHASE1_SLICE1_AUTH_DESIGN.md). Approving a hostname does not implicitly authorize replacing another product's existing portal binding.

The existing Monotorr 365 portal retains `https://app.monotorr.com`; the owner explicitly rejected detaching/transferring it. ConnectWise uses `https://portal.monotorr.com` and a separate organizational-accounts-only browser Entra registration. No admin-only identity is designated or required in Slice 1, and no ordinary customer has admin access.
