# V1 Portal + Onboarding Cleanup Plan

Status: Approved scope / implementation pending

Owner goal: Launch-ready onboarding with minimum architectural change.

Change control: Any change that alters authentication architecture, account resolution, Descope identity semantics, or MCP authorization requires separate review before implementation. This plan authorizes planning only; implementation, live presentation changes, deployment and cleanup each require a separate task/approval.

Created: 2026-10-12. Working branch: `phase1-hardening`.

## 1. Authority, baseline and scope

This is the working plan for the next launch slice: **Portal + Onboarding Cleanup**. Customer journeys, vocabulary, information architecture, state accuracy and bounded presentation changes are in scope. No application/configuration change is made by creating this plan.

Authority: [V1 Product Architecture](V1_PRODUCT_ARCHITECTURE.md), [V1 Implementation Plan](V1_IMPLEMENTATION_PLAN.md), and the accepted [Slice 3 closeout](PHASE1_SLICE3_ACCOUNT_AWARE_MCP.md#accepted-production-closeout--2026-10-12) / [Azure delivery runbook](V1_AZURE_DELIVERY_RUNBOOK.md#phase-1-slice-3-accepted-production-closeout--2026-10-12). The architecture remains authoritative for security and product boundaries; this approved focused slice defines the next onboarding work. Existing architecture/implementation documents are not rewritten by this task.

Accepted production baseline:

- Slice 3 executable source `6ba244571acf3c485aa1cdf6141607ae4e764b00`; cutover run `38317025739` succeeded.
- Account-aware production MCP is `connectwise-mcp-pilot--s3-6ba244571acf`, Healthy, Single mode, 100% traffic; canonical endpoint `https://api.monotorr.com/mcp`.
- Native USER B works in ChatGPT; USER C receives setup_required with no foreign metadata and zero secret/CW attempts; historical USER A is denied with no pilot fallback.
- Exact contract: 39 read tools, 0 write tools; schemas and TLS/SSRF/redirect protections preserved.
- Control API and portal healthy; two explicit external bindings, zero pending link attempts at closeout.
- Descope stable: primary native email OTP, secondary historical SAML retained, exact scope enforced in MCP, Option E rules empty/default allow. No new Agentic policy is part of this slice.

The customer mental model is:

**Connect ConnectWise → Connect your AI → Start asking questions.**

Customer-facing text must not require understanding MCP identity, identity binding, Descope, SAML, issuer/sub or internal entitlement terminology. The copyable technical field may be called **MCP server address** because clients use that term; define it simply as the address to paste into the customer's AI app.

## 2. Supported customer journeys

### Primary: Monotorr-first

1. Sign in to Monotorr with a Microsoft business account.
2. Connect ConnectWise using the existing four-input secure setup and connection validation.
3. Choose **Connect your AI**, with ChatGPT as the primary path.
4. If required, complete the existing Monotorr email-code verification and explicit association within this setup step. Return to the portal, copy the server address and follow the ChatGPT connection instructions. This is part of one customer setup task, not a separate “Link AI” task.
5. Authenticate in the AI connection using the email chosen in that setup step, finish consent, and return to ChatGPT.
6. Start asking questions. Suggested first prompt: “List my ConnectWise service boards.” A successful read is a useful smoke, not a broad permissions/readiness assessment.

Microsoft browser login and native AI email verification remain distinct internally. Emails need not match. Customer instructions may say “Use the email you chose when connecting your AI”; do not infer ownership from an email match or add profile/email lookups to hide that distinction. Refresh, logout/re-login and repeat setup must preserve the same internal account, trial and connection without creating duplicates or reassigning bindings.

### Secondary: AI-first

1. Add `https://api.monotorr.com/mcp` in ChatGPT, Claude or another verified-compatible MCP client.
2. Authenticate with Monotorr's native email code.
3. If access/setup is incomplete, follow concise help to `https://portal.monotorr.com`.
4. Sign in with Microsoft; complete the existing **Connect your AI** association if missing, then ConnectWise setup if required. When available, the portal still leads with ConnectWise first.
5. Return to the AI app and retry; reauthorize the same native email only if the client requires it.
6. Ask questions once account access, ConnectWise and authorization are valid.

AI-first is supported as a fail-closed entry path, not automatic account provisioning. Native OTP does not create a Monotorr account/membership/trial or bind a Microsoft account. An unlinked principal currently receives access_denied; a linked, entitled account without a connection receives setup_required. Phase A must verify what the client actually displays. Publish a portal/help destination beside setup instructions; do not promise an automatic redirect, clickable server denial or new guided flow the current client does not expose. No sophisticated AI-first orchestration is required here.

## 3. Portal information architecture

Retain a compact setup console and the existing visual system, with three sections in this order. Avoid adding a dashboard or complex navigation.

### Header

**Monotorr ConnectWise**

**Your ConnectWise data. Your AI.**

Keep signed-in account context and Log out accessible, with no internal account/provider identifiers.

### Section 1: ConnectWise

- Connected / Not connected / Needs attention, based on known backend state.
- Own-account server/company summary where configured; no key values, secret references or other-account metadata.
- Primary action: Connect ConnectWise for a new account; Test connection or Manage connection only where the existing implementation safely supports it.
- States: Not configured, Connected, Disconnected/error. A saved validation result is not a guarantee of current live reachability.
- If test/manage/disconnect/credential replacement is not implemented, do not render a dead control or expand this cleanup into the full connection lifecycle. Identify the precise gap in Phase A and request a bounded follow-up if required.
- Testing must remain an explicit, authorized GET-only action; page load/refresh must not fetch customer secrets or call ConnectWise merely to paint status.

### Section 2: Connect your AI

ChatGPT is the primary card. Include:

- Short useful next-action copy.
- `https://api.monotorr.com/mcp`, labelled **MCP server address**.
- **Copy MCP address**, with accessible success/failure feedback and a selectable-text fallback.
- **Connect ChatGPT** only if the action can safely start a verified guided path; otherwise **Open ChatGPT**, paired with concise setup instructions. Opening ChatGPT does not prove a connection exists.
- A compact explanation of email-code verification, client consent and returning to the AI app.
- Compact Claude, Copilot and Other MCP-compatible client cards below; use the same endpoint and authentication architecture.

Never show “MCP identity”, “linked identity”, issuer/sub, Descope, SAML or internal OAuth client names in normal customer setup. Backend association can remain unchanged. The native verification step belongs inside this card's overall connection journey; a generic external link must not skip a required association silently.

### Section 3: Account

Render customer-friendly current access information, only when supplied by trusted backend state:

| Internal source (implementation only) | Customer wording | Useful supporting information |
| --- | --- | --- |
| trial | Trial | “Trial ends …” with an understandable local date/time |
| web_paid | Paid plan | Renewal/access date only if reliably available |
| comp | Complimentary access | End date if applicable; no forced billing UI |
| substack | Included with your subscription | Relevant access end date if supplied; no forced Stripe UI |
| absent/expired/unknown | Access inactive / Status unavailable, as appropriate | A bounded explanation and verified support action |

Do not print raw access-source enums, “Entitlement status”, internal IDs or provider details. Do not fabricate renewal dates from trial/access expiration. Billing checkout, plan changes, Substack claiming and complimentary provisioning are excluded. Future/source-specific labels describe existing backend values; they do not claim these commercial paths are implemented now.

## 4. Truthful state and next-action model

### Evidence boundary

Current GET `/connectwise/v1/ai/status` returns only `linked: boolean`. That is an internal association prerequisite, not evidence of a configured ChatGPT connection, a current OAuth session, a particular AI client or a successful tool call. URL copying, opening an AI app, finishing the portal callback and selecting “I've connected” also do not prove an active external connection.

Default launch mapping: after prerequisites are satisfied, show **Ready to connect** and setup instructions. Show **Connected** for an AI client only with a defined reliable evidence source; label any customer acknowledgment explicitly as setup confirmation rather than server-verified live connectivity. Do not invent session/refresh health or infer it from email. No telemetry platform, per-client credentials or new persistent event pipeline is introduced merely to paint a badge.

If no reliable external-connected/reconnect evidence exists, Phase B must use truthful readiness/help wording. Phase C may propose a minimal state exposure only after its data source, freshness, ownership and failure behavior are reviewed. A false Connected indicator is a launch failure. Do not treat an unknown state as either disconnected or connected.

| State | Visible status | Primary next action | Secondary action | Avoid |
| --- | --- | --- | --- | --- |
| A. New account, no ConnectWise | ConnectWise: Not connected; AI setup not ready | Connect ConnectWise | Brief “Connect your AI next” explanation | MCP identity not linked; entitlement enums; an active-looking ChatGPT connection badge |
| B. ConnectWise connected, no AI connection yet | ConnectWise: Connected; AI: Ready to connect, or email verification needed within setup | Connect ChatGPT / Connect your AI setup | Copy MCP address; compact other-client instructions | Link AI as a separate task; declaring Connected from linked=true |
| C. Fully configured and client works | ConnectWise: Connected; “Start asking questions”; AI Connected only with defined evidence, otherwise Ready to connect/return-to-AI guidance | Open ChatGPT and ask a question | Copy address / reconnect help / other-client setup | A claim that the portal detects an active ChatGPT session when it cannot |
| D. ConnectWise disconnected/error | Not connected / Needs attention using a sanitized reason | Reconnect/manage only where supported; otherwise verified support instructions | Test existing connection only where implemented | Raw CW errors, keys, foreign metadata; pretending AI reconnect repairs CW credentials |
| E. Access expired | Trial ended / Access inactive | Verified contact/support or existing permitted access-restoration path | View connection summary / account information where allowed | Active entitlement=false; invented checkout, comp grants or access bypass |
| F. AI authorization/reconnection required | Reconnect when reliably known; otherwise “Having trouble connecting?” help | Reauthorize in the AI app with the email used for setup | Verified support; select a different supported client | Identity replacement, email matching, automatic merge or false refresh-token/session health |

Priority: access restrictions first, then ConnectWise setup/error, then AI connection instructions, then use. A service failure shows **Status unavailable — Try again**, does not reset saved setup, does not fabricate Connected and does not reveal internal errors. A disabled/unknown account fails closed; the UI never grants access.

Reconnect means reauthorization of the same existing principal. Changing the chosen email/principal may require a future recovery operation: stop with safe support guidance, do not overwrite the binding. Preserve explicit origin/session/state/PKCE/one-use callback controls and immutable account ownership.

## 5. Vocabulary and copy rules

| Remove from customer UI | Preferred replacement |
| --- | --- |
| AI Setup | Connect your AI |
| Link AI / Link AI identity | Connect ChatGPT or Continue setup within Connect your AI |
| MCP identity: Linked / Not linked | Ready to connect / setup guidance, according to actual prerequisites |
| Linked identity / issuer/sub / Descope | Omit; explain only the customer's next action |
| Authorize using the identity you linked | Use the email you chose when setting up your AI connection |
| Active entitlement / access source | Trial / Paid plan / Complimentary access / Included with your subscription |
| OAuth client / scope implementation labels | Monotorr ConnectWise / understandable read-only permission text |

Use “Connected” and “Reconnect” only when supported by known state. Do not claim separate Microsoft and AI emails must match. Explain API-key inputs only where customers need to enter them; never expose stored values. Preserve useful server/company context and customer-controlled logout. Setup text must remain accessible on small screens, with labelled controls, keyboard navigation, loading/error states and copy feedback.

## 6. ChatGPT onboarding and destination verification

Launch target:

1. Sign in to the ChatGPT account/workspace you intend to use.
2. Open ChatGPT's supported plugin/MCP connection area.
3. Add Monotorr ConnectWise with `https://api.monotorr.com/mcp` using the published HTTPS connection path.
4. When Monotorr authentication appears, use the primary email-code option, complete native verification and consent; use the email chosen during portal setup.
5. Return to ChatGPT and enable/select the connection as required by its current supported UI.
6. Ask a small read question, such as listing service boards. Confirm the connection before broader use.

Research snapshot, 2026-10-12: official OpenAI guidance describes **ChatGPT Plugins → plus → Add custom MCP server**, entering a server URL, configuring authentication and then installing/selecting the resulting plugin. Workspace permissions can affect availability. This is a reference for audit, not a claim that every account has the same UI or that a stable direct setup URL exists. See [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server) and [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt).

Phase A must reverify the exact supported destination and labels in the intended customer account/workspace before implementation. Accept a deep link only if officially supported, stable and tested signed in/signed out/in the wrong workspace. No documented stable connection-creation deep link was established by this planning review; do not invent one. Fallback: **Open ChatGPT** at `https://chatgpt.com/` plus short tested instructions and Copy MCP address. That button starts navigation, not account linking or external OAuth completion. Do not depend on undocumented settings URLs, automatic account selection or automatic client installation.

If workspace policy blocks setup, show an actionable “Ask your AI workspace administrator” instruction rather than altering Monotorr scopes or policies. Prefer reauthorizing an existing connection for reconnect; remove/re-add only if the verified client flow requires it. Use native customer authentication; historical SAML is not a customer onboarding route.

## 7. Claude, Copilot and other clients

| Card | Launch content | Verification gate |
| --- | --- | --- |
| ChatGPT | Primary guided steps and Open/Connect action | Supported destination/UI, workspace eligibility, native OTP, consent and successful read |
| Claude | Compact setup instructions, copyable server address, native-email reminder | Verify the current Claude product/plan's remote MCP and OAuth path; do not assert universal support |
| Copilot | Compact setup instructions or compatibility/help guidance | Name the exact Copilot product/client and verify supported remote MCP/OAuth; avoid conflating different Microsoft products |
| Other MCP-compatible client | Server address plus generic remote HTTPS/OAuth instructions | Client must support the existing resource/audience/scope/code-PKCE flow; document any actual client limitation |

Do not ship a broken Connect action or an unsupported success claim. If a client variant cannot use the existing endpoint safely, give an explicit verified compatibility limitation/help path and treat that launch-instruction item as unresolved until reviewed. No new issuer, per-client backend, scope, policy or authentication fallback is approved here. Current vendor-specific detailed instructions remain to be verified in Phase A; this plan does not pretend they were live-tested.

## 8. Descope customer presentation

Phase A inspects current screenshots/console/export read-only. Normal customer authentication is native email OTP, branded **Monotorr ConnectWise**, with customer-friendly button and consent copy. Internal client names should not appear where safe display metadata can avoid them. Read-only permission wording should explain access to the customer's ConnectWise data through Monotorr without claiming write access, email ownership or permissions beyond actual scopes.

The prior “undefined” permission display appears corrected; verify the live screen before proposing any change. Do not fix a display problem by recreating a resource, changing scope optionality or adding scopes. Existing connectwise.read remains optional in provider consent and mandatory in application verification; declining it must continue to fail before account/secret/CW access. A wording/presentation change must preserve consent semantics.

Retain historical USER A and SAML for rollback/legacy infrastructure. SAML must not be the normal customer-facing choice. If the current shared flow exposes it, Phase A must distinguish display-only cleanup from changes to SAML actions or historical client behavior. Any hiding/relabeling must preserve the supported legacy/recovery path and receive a separate exact-flow review; do not remove the actions, user or SAML configuration. Presentation work must not change valid-session handling, email merging, SSO-only conversion, OTP limits, native signup behavior, resource/issuer/audience, scopes, callbacks, clients, policies or PKCE behavior.

OTP policy is already proven; this slice does not need another delivery-policy experiment. Do not collect codes, provider credentials, bearer tokens or full callback URLs in audit evidence. Phase D acts only on verified necessary display-name/logo/copy/native-presentation items, after separately approved console/API targets and a rollback copy.

## 9. Identity and architecture boundary (implementation only)

**Monotorr account is durable. Descope identity is replaceable.**

- Durable: internal user/account and membership, access/trial, ConnectWise connection, customer configuration/data.
- External authentication association: verified Descope issuer + subject explicitly owned by the authenticated internal user/account.
- Portal Microsoft login and MCP native login remain independent. No email/domain equality, guest federation or privileged owner shortcut establishes ownership.
- Replacement is a future supported recovery operation with separate verified authorization; this cleanup does not implement replacement, merge or reassignment.

Preserve exact issuer/resource/connectwise.read verification, fixed public linking client, exact callback, state/session binding, PKCE S256, one-use attempt consumption, immutable uniqueness/ownership, and rejection before secret/CW access. Preserve account-scoped metadata/opaque secret references, no raw keys in PostgreSQL, no pilot fallback and no client-supplied account selectors.

Phase C can expose only minimal trusted status if required. Do not add profile/email/subject IDs to customer responses, use an admin route, inspect AI tokens from the browser, or invent per-client connectivity from a principal association. No new table, history pipeline or background credential test is presumed necessary. If the smallest functional change alters identity/account/authorization semantics, stop for separate architecture review.

## 10. Implementation phases and gates

Phase labels A–E below belong only to this cleanup plan; they do not authorize the full numbered V1 Phase 4.

| Phase | Work and output | Approval / exit gate |
| --- | --- | --- |
| A — Current-state audit | Read-only portal text/components/states; existing Link AI/callback behavior; ChatGPT path/destination; Descope branding/consent/undefined display; status evidence. Produce an observed-vs-proposed matrix, client compatibility checks, exact gaps and smallest file/flow targets. No writes, OTP tests or configuration changes without specific test approval. | Verify current facts, screenshots and official client instructions. Resolve AI-state truthfulness and required association sequencing. Present bounded B/C/D implementation scope. |
| B — Portal copy / IA cleanup | Copy, component structure, status labels, setup instructions, address copy action, primary ChatGPT and compact secondary cards, accessibility/loading/error behavior. Reuse existing API/auth/visual system. | Separate implementation task. No unsupported test/manage button or false Connected badge. Focused UI/state tests and normal portal/source checks. |
| C — Small flow / state changes | Only proven necessary simplification of Connect your AI, minimal trusted state exposure, narrow routing/navigation changes. Binding/session controls unchanged. | First document data source, ownership, freshness and failure semantics. Separate review for every auth/account/identity/authorization change; no bypass or architecture rewrite. |
| D — Descope presentation cleanup | Only verified required display name, logo, consent copy, primary native-OTP presentation or actual undefined-text fix. | Exact target/change approval, captured original values/flow rollback, no scope/policy/user/identity-semantic changes. Do nothing if audit shows the item already correct. |
| E — Regression / launch acceptance | New-customer portal journey, native OTP/consent, ChatGPT end-to-end, compact client instruction checks, honest state UI, no internal terminology, B/C/A isolation and unchanged MCP surface/security. | Existing immutable delivery/provenance/promotion gates and separate live approval; sanitized acceptance, rollback readiness, explicit owner dogfood. |

Deploy only through the existing reviewed release path. Classify actual MCP impact; unchanged proof may qualify for control-only delivery, changed/unknown impact requires the existing MCP review path. Never assume presentation intent implies no runtime impact. No deployment, evidence dispatch or live action is authorized by creating/committing this plan.

## 11. Regression and definition of done

Cleanup is complete only when:

- A new MSP owner can follow **Connect ConnectWise → Connect ChatGPT → Start asking questions** without learning identity-binding concepts.
- No normal portal/consent copy exposes MCP identity, linked identity, issuer/sub, Descope, SAML or raw access-source implementation fields; the technical copy field is explained in plain language.
- Every A–F state has an accurate status and next action, including unknown/unavailable states; linked=true is never misrepresented as an active AI session.
- Native OTP and explicit association/callback complete without loops, repeated setup, unsafe merges or duplicate internal accounts/trials/connections.
- ChatGPT setup works end-to-end in a real intended customer account/workspace with the verified supported path. Connection/board read succeeds after native customer authentication.
- Claude/Copilot/Other have concise verified launch-safe instructions or an explicit reviewed compatibility limitation; unsupported paths are not advertised as working.
- Descope screens are branded and understandable; permission labels are defined; existing scope and consent behavior are preserved.
- USER B remains connected to Customer 1; USER C remains isolated/setup_required with zero customer-secret/CW attempts; USER A remains denied/no-fallback. Cross-account/concurrency protections remain intact.
- Authenticated production inventory remains exactly 39 read tools / 0 writes, schemas unchanged, with TLS, SSRF, redirect and GET-only protections unchanged.
- Portal Microsoft login/logout, original trial expiration, persistence, origin checks, state/PKCE/session ownership and replay/conflict denial remain correct.
- No credentials/tokens/customer payloads enter UI artifacts, logs, plans or acceptance reports; no live secrets are redisplayed.
- Run relevant focused UI/state/auth/linking tests, the normal full suite (disposable PostgreSQL integration for affected backend paths), builds/TypeScript/lint/audits/ticket-card/diff gates as appropriate to actual changes, then separately approved deployed smoke and owner dogfood. Do not silently skip existing release gates.
- Record exact source/artifact/revision evidence, fallback/rollback behavior and unresolved external-client eligibility limitations. Retain stabilization assets throughout this slice.

## 12. Non-goals and reconciliation with existing plans

Explicitly excluded: billing/Stripe/commercial acquisition implementation; Basic Internal Admin Console; ConnectWise permissions/readiness assessment; new MCP tools; identity replacement/recovery UI; USER A/SAML removal; rollback/candidate/legacy-access cleanup; multiple connections; multiple PSA products; major visual redesign; broader telemetry/dashboard implementation; onboarding email campaigns; feature work beyond setup.

Existing architecture Sections 21–22 allow a minimal setup console and next-action onboarding, consistent with this plan. Three focused sections refine the possible Home/ConnectWise/AI Setup/Account structure without changing its security boundary. Customer-friendly account-source display does not remove internal access enforcement.

Existing implementation Phase 4 also includes permissions/readiness, and full V1 launch requires billing and an internal admin console later. Those are not approved by this focused cleanup slice; its completion is not a claim that all V1 launch requirements are complete. No new readiness tracking/schema or Phase 6 telemetry work is pulled in here.

Some existing implementation text still labels account-aware Slice 3 as pending, while accepted closeout records production PASS. Treat it as historical status, cite the accepted evidence, and leave the architecture/implementation files unchanged in this task. The optional AI-connected checkpoint in the broad plan is not implemented by the current binding boolean; this plan requires verified evidence or truthful Ready to connect wording, not invented telemetry.

No unresolved architecture change is required to write this plan. Practical gaps for Phase A: supported external-connected/reconnect detection, currently unavailable test/manage lifecycle actions, stable ChatGPT destination/account eligibility, exact Claude/Copilot variants, and whether Descope presentation needs any change at all. Any change beyond these bounded presentation/state decisions requires separate review.

## 13. Change control and handoff

Audit first, present the observed facts and exact smallest targets, then obtain separate implementation/live approvals for B/C/D/E. Preserve the durable account model, fixed endpoint, read-only MCP contract and all retained rollback assets. Never weaken authorization merely to make setup look simpler.

This task commits/pushes only `docs/V1_PORTAL_ONBOARDING_PLAN.md` with subject **Add V1 portal onboarding plan**. The two uncommitted Slice 3 closeout documentation files remain outside this commit. Preserve the three historical untracked continuity files unchanged and excluded from staging. No application/configuration/Descope/Azure/database/deployment or rollback cleanup change is authorized here.
