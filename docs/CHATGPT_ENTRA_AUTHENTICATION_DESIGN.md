# ChatGPT / Entra authentication design

> **Superseded decision, 2026-10-04:** actual workforce discovery returned no advertised S256; the direct-Entra design below is historical and must not be implemented. Descope is now the MCP authorization server; Entra is only upstream SAML identity. Descope S256 discovery and Monotorr SAML/JIT login passed. The resource-server verifier is implemented; ChatGPT exchange, real MCP claims/audience/scope, refresh and Azure deployment remain unvalidated. Current exact values and code/test gates are in [ChatGPT / Descope live test](CHATGPT_DESCOPE_MCP_LIVE_TEST.md). Do not create the historical direct-Entra MCP API/client registrations for this broker design.

Research date: 2026-10-04. Design only; no application, configuration, credentials, Azure resources, deployments, or app registrations changed. The baseline is [Phase 1 hardening](PHASE1_HARDENING.md).

**Decision: pursue a direct Entra integration through a narrowly scoped compatibility check, but do not call it production-ready or unconditionally compatible yet.** Microsoft documents native MCP resource indicators. The concrete blocker is discovery: the public Entra `organizations` document fetched during this review lacks the PKCE capability field required by MCP. Your tenant-specific document and ChatGPT's fixed-client behavior remain untested.

## Evidence and compatibility assessment

OpenAI supports predefined OAuth clients alongside CIMD and DCR. Therefore Entra's lack of DCR does not by itself require building an authorization server. Microsoft's App Service guidance explicitly calls for client preregistration when using Entra. [OpenAI authentication](https://developers.openai.com/plugins/build/auth), [Microsoft MCP authentication](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-mcp).

| Area | Finding | Implication |
| --- | --- | --- |
| Authorization code / PKCE | Entra documents code flow with S256. | The underlying flow exists. |
| Discovery of PKCE | Fetched public metadata has no `code_challenge_methods_supported`. | Runtime support alone is insufficient for strict MCP discovery. |
| CIMD | No CIMD capability advertised in the fetched metadata; no native CIMD integration established by the reviewed Microsoft guidance. | Do not send OpenAI's metadata URL as an Entra client ID or claim CIMD support. |
| DCR | Microsoft explicitly says Entra does not support RFC 7591 registration. | Register a client manually; Microsoft Graph app creation is not an unauthenticated DCR endpoint. |
| Fixed client | Documented preregistration route exists. | Confirm ChatGPT's exact configuration interface and token authentication method live. |
| Resource indicators | Microsoft now documents matching the MCP resource URL to the API Application ID URI. | Keep `resource`; use matching API scopes and v2 tokens. |

Code-flow support comes from [Microsoft's authorization-code reference](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). DCR findings come from [Microsoft's Copilot OAuth guidance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-oauth). Resource support comes from [Microsoft's MCP-specific guidance, updated September 2026](https://learn.microsoft.com/en-us/entra/agent-id/secure-mcp-server-with-entra-id).

The public discovery observation is directly reproducible at [Entra organizations discovery](https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration). Its token methods include `client_secret_post`, `client_secret_basic`, and `private_key_jwt`; it does not advertise a registration endpoint, CIMD, S256, or RFC 9207 response issuer identification. This is a public endpoint observation, **not an inspection of your tenant**. Its issuer uses a tenant placeholder and is not the Phase 1 issuer we should configure. `private_key_jwt` support does not imply support for automatically fetching OpenAI CIMD/JWKS metadata.

[MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) requires clients to refuse discovery without advertised PKCE support. Consequently a successful MSAL or browser login is not proof that ChatGPT discovery will succeed. Do not fix this by falsely advertising capabilities, changing the issuer to our hostname, reviving the inherited proxy, or silently dropping the resource parameter.

## Proposed flow and endpoint ownership

The following is the desired direct flow, **conditional on the discovery gate passing**. `T` is the actual tenant GUID, `A` the new MCP API application GUID, and `C` the separate ChatGPT client application GUID.

```mermaid
sequenceDiagram
    actor U as Internal user
    participant G as ChatGPT
    participant M as api.monotorr.com MCP service
    participant E as Entra tenant T
    participant W as ConnectWise Manage API
    U->>G: Link private MCP connection
    G->>M: POST /mcp without access token
    M-->>G: 401 + WWW-Authenticate resource_metadata
    G->>M: GET /.well-known/oauth-protected-resource/mcp
    M-->>G: resource URL, Entra issuer, read scope
    G->>E: GET /T/v2.0/.well-known/openid-configuration
    E-->>G: authorize/token/JWKS endpoints and capabilities
    Note over G,E: Stop if S256 is not advertised; client C is preregistered
    G->>U: Start OAuth linking in browser
    U->>E: /T/oauth2/v2.0/authorize: client C, code flow, S256, state, resource, scopes
    E->>U: Sign in, MFA / tenant policy, consent
    E-->>G: Code + state at exact registered ChatGPT callback
    G->>E: POST /T/oauth2/v2.0/token: code, verifier, resource, client authentication
    E-->>G: Access token for API A + refresh token if offline_access granted
    G->>M: POST /mcp with Authorization: Bearer access token
    M->>M: Validate token and staff authorization on every request
    Note over M: Resolve service CW config only after authorization
    M->>W: Read-only GET using dedicated CW API member credentials
    W-->>M: CW result
    M-->>G: MCP tool result
    G-->>U: Answer
    G->>E: Later refresh_token grant at same token endpoint
```

Discovery does not require our service to act as the authorization server. The resource metadata describes where the client must go; Entra owns login, consent, code issuance and token exchange. [Protected-resource metadata standard](https://www.rfc-editor.org/rfc/rfc9728.html), [authorization-server metadata standard](https://www.rfc-editor.org/rfc/rfc8414.html).

| URL | Owner / purpose | Required for this design? |
| --- | --- | --- |
| `https://api.monotorr.com/mcp` | Dedicated MCP service, Streamable HTTP | Yes |
| `https://api.monotorr.com/.well-known/oauth-protected-resource/mcp` | MCP resource metadata for the `/mcp` resource | Recommended primary metadata route |
| `https://api.monotorr.com/.well-known/oauth-protected-resource` | Root metadata discovery fallback pointing to the same resource | Supported standard alternative; expose for interoperability if this host's routing permits it |
| `https://login.microsoftonline.com/T/v2.0/.well-known/openid-configuration` | Entra discovery | Yes, hosted by Microsoft |
| `https://login.microsoftonline.com/T/oauth2/v2.0/authorize` | Entra browser authorization | Yes, use actual discovered value |
| `https://login.microsoftonline.com/T/oauth2/v2.0/token` | Entra code exchange and refresh | Yes, use actual discovered value |
| `https://login.microsoftonline.com/T/discovery/v2.0/keys` | Entra signing keys | Use actual `jwks_uri` from trusted tenant metadata |

The path-qualified metadata route follows the MCP/RFC discovery convention; `/mcp/.well-known/...` is not the proposed route. Root metadata is an alternative, not a second OAuth service. If Monotorr already owns a root metadata route, reserve the path-qualified route and advertise it explicitly; do not overwrite another API's metadata. No local `/.well-known/oauth-authorization-server`, `/authorize`, `/token`, `/register`, `/login`, or OAuth callback endpoint is needed for direct Entra. The callback belongs to ChatGPT, not this API.

Illustrative resource metadata, not configuration applied by this review:

```json
{
  "resource": "https://api.monotorr.com/mcp",
  "authorization_servers": ["https://login.microsoftonline.com/<TENANT_GUID>/v2.0"],
  "scopes_supported": ["https://api.monotorr.com/mcp/connectwise.read"],
  "bearer_methods_supported": ["header"]
}
```

### Resource, scope and audience are distinct

Proposed identifiers:

- Canonical MCP resource and Entra API Application ID URI: `https://api.monotorr.com/mcp`.
- Fully qualified delegated scope requested by ChatGPT: `https://api.monotorr.com/mcp/connectwise.read`.
- Scope claim checked in the API token: `scp` contains the exact space-delimited value `connectwise.read`.
- Accepted v2 token audience: the MCP API application GUID `A`, **not** client GUID `C`, Microsoft Graph, a Monotorr application ID, or a guessed collection of URL audiences.

Enable `api.requestedAccessTokenVersion: 2` before setting the HTTPS identifier URI. Microsoft's MCP guidance requires the resource and scope to resolve to the same API registration; mismatches can produce `AADSTS9010010`. Both authorization and token requests must retain ChatGPT's resource value. Generic older descriptions of Entra v2 using only scopes do not override the newer MCP guidance. [Microsoft MCP configuration](https://learn.microsoft.com/en-us/entra/agent-id/secure-mcp-server-with-entra-id).

RFC 8707 permits mapping a resource URL to a different token audience identifier; a URL-to-API-GUID mapping is legitimate. OpenAI's URL audience example is not a requirement to accept only a literal URL `aud`. Confirm the issued token follows the documented GUID mapping and validate that one API audience. [Resource indicators](https://www.rfc-editor.org/rfc/rfc8707.html), [Microsoft token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference).

### Refresh and identity scopes

ChatGPT requests advertised `openid`, `email`, and `profile` scopes by default; ensure these are enabled. [OpenAI OIDC scope handling](https://developers.openai.com/plugins/build/auth).

Request `offline_access` in the code flow if persistent linking is wanted. Entra v2 requires it explicitly to issue refresh tokens. `openid`, `profile`, and `email` are identity scopes; enable the advertised scopes the client requests, without adding broad Graph data permissions. [Microsoft scopes](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc).

ChatGPT performs token exchange/refresh directly with Entra; the MCP service neither stores refresh tokens nor runs a refresh job. Use the same registered confidential client for refresh. Replacement refresh tokens are returned, but Entra does not automatically revoke the old token on use; do not describe this as strict one-time replay-proof rotation. Conditional Access, session policies, revocation, client-secret expiry and client storage behavior require live testing. Do not promise permanent login or immediate revocation of already-issued access tokens. [Microsoft refresh-token behavior](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens).

### Staff authorization policy

Proposed server policy requires **all** of the following: valid Entra signature using trusted tenant JWKS; exact tenant-specific `iss`; mandatory matching `tid`; v2 token; valid `exp` and `nbf`; `aud=A`; delegated `scp=connectwise.read`; allowed client `azp=C`; immutable user identity; and API role `CWM.Read`. Reject app-only tokens even if they carry roles. Do not authorize by email domain, display name, UPN, or an ID token. JOSE performs cryptographic verification; the application checks the narrow authorization policy. Claims and delegated/app-only distinctions are documented in [Microsoft token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference) and [delegated permissions](https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/application-delegated-permission-access-tokens-identity-platform).

For one user, assign that user directly to `CWM.Read` on the **API** enterprise application; require assignment where supported and tested. Use the delegated scope to represent permitted operations, and the user app role to represent who may perform them. Later assign an internal security group to the role rather than writing Graph group-expansion code. App roles avoid raw group-claim overage and tenant-specific group IDs in the application policy. [API app roles](https://learn.microsoft.com/en-us/entra/identity-platform/howto-add-app-roles-in-apps), [group-claim limitations](https://learn.microsoft.com/en-us/security/zero-trust/develop/configure-tokens-group-claims-app-roles).

Tenant restriction alone does not mean employee-only: an invited guest can receive a token for this tenant. Direct role assignment to the intended employee provides the Phase 1 restriction. Determine removal/revocation latency live; stateless JWT validation cannot detect every mid-lifetime change without additional policy. All authorized Phase 1 users share the dedicated CW member's read privileges; Entra does not automatically translate an employee's CW permissions.

### Existing Monotorr infrastructure

Reuse the tenant, staff identities, administrators, MFA/Conditional Access capability, domain/DNS ownership, subscription and operational knowledge. Existing Partner Center verification and verified domains may shorten publisher setup. Still create separate registrations, consent, assignments and service identities, and associate publisher information with each new application where appropriate. Existing app publisher verification is not automatically inherited by every new registration. [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), [per-app publisher association](https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified).

Publisher status mainly improves consent trust and future external adoption; it does not add CIMD/DCR, change Entra discovery, authorize ChatGPT callbacks, provide CW permissions, grant ChatGPT workspace access, or fix PKCE metadata. It is not evidence that this separate service has passed a security review. Its practical benefit is small for one internal user with admin-controlled consent. [Microsoft application publication guidance](https://learn.microsoft.com/en-us/entra/architecture/establish-applications).

For operational separation, use distinct app IDs, client credentials, API scopes/roles, managed service identity, deployment pipeline, Azure resource ownership/access and logs. The custom domain may be shared via routing; the API audience and secrets must not be shared with Monotorr.

## Recommended Phase 1 Authentication Architecture

**Preferred conditional design:** direct, single-tenant Entra authorization with a preregistered confidential ChatGPT client; the independent Node MCP service acts only as a resource server. Keep all 39 read tools behind one delegated read scope and an explicitly assigned staff role. Use maintained JOSE validation at the existing HTTP boundary. No local authorization-server proxy or session-token broker is needed if the compatibility gates pass.

Choose this over a public-client workaround: Entra's observed metadata does not advertise `none`, and a confidential Web client avoids depending on permissive public-client settings. PKCE is still required. A shared OAuth client secret authenticates the client during code exchange; it is not a static bearer credential for `/mcp`. Confirm ChatGPT can be configured with the fixed client and an advertised method, preferably `client_secret_post`, before creating production credentials.

App Service Easy Auth is an optional platform validation layer, not a solution to missing Entra discovery capabilities. Its MCP protected-resource support is preview, and staff-role/scope policy still needs explicit enforcement. Keep one clear source of resource metadata and forbid direct bypass of platform validation if used. For this existing raw Node service, the JOSE boundary is the smaller proposed application change. [App Service MCP support](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-mcp).

If tenant discovery cannot satisfy S256 or ChatGPT cannot use the fixed-client flow, **stop the direct design**. Evaluate an established MCP-compatible authorization broker federated to Entra in a separate design decision, including its token issuer, resource binding, storage and operational cost. A metadata-only shim is not an assumed standards-compliant fix. Do not automatically introduce another hosted provider or write a custom OAuth server.

Future Copilot can use its own client registration/consent against the same API and a deliberate allowed-client policy extension. Microsoft documents static OAuth configuration for Entra-backed MCP plugins. This does not mean Copilot support is implemented, nor identify which Copilot product the future project will use. [Copilot OAuth configuration](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-authentication-oauth).

Future commercial multi-tenancy requires a separate tenant-onboarding and data-isolation design, per-tenant CW configuration, consent and issuer authorization. Do not enable `common` or broadly accept new audiences now. Separate resource/client registrations and app roles preserve options without coupling this service to Monotorr's application.

## Entra App Registrations Required

| Registration | Proposed configuration | Why separate? |
| --- | --- | --- |
| ConnectWise MCP API | New single-tenant resource app; v2 tokens; HTTPS identifier URI; `connectwise.read` delegated scope, admin consent; `CWM.Read` role allowed for Users | Own audience, staff assignments, consent and lifecycle; no reuse of Monotorr API |
| ChatGPT client for ConnectWise MCP | New single-tenant confidential Web client; exact ChatGPT redirect; only MCP delegated permission and needed identity/offline scopes; supported client authentication | Represents ChatGPT's OAuth client for this connection; separate rotation/redirect/permissions |

An API that only validates incoming tokens does not need a client secret just to validate signatures. The client credential belongs to the OAuth client and would be configured securely with ChatGPT later, not used by CW calls. A managed identity for future Azure secret access is a separate identity concern, not either OAuth role. No credentials were created in this step.

No global ChatGPT Entra application GUID was established by this review. The preregistered GUID is assigned by your new registration; its display name alone does not prove a request came from OpenAI. Do not repurpose Monotorr's client ID or the OpenAI CIMD URL as that GUID.

## OpenAI / MCP Requirements Checklist

| Requirement | Design / status |
| --- | --- |
| Protected resource metadata | Public GET path-qualified metadata, optional root alias; exact HTTPS resource; tenant issuer and minimal read scope. Required resource contract. |
| Authorization-server discovery | Refer to real tenant Entra issuer and its Microsoft-hosted OIDC document; do not impersonate Entra on our hostname. |
| Code flow and PKCE | Authorization code, state, verifier and S256; Entra supports the flow. **Advertised S256 remains a blocker to validate.** |
| Client registration | CIMD preferred where supported; DCR optional; use predefined client for Entra. Fixed-client UI/method must be verified. |
| Callback | Copy exact callback from ChatGPT connection management. No guessed wildcard, localhost, Claude or Monotorr callback. |
| `resource` | Same `https://api.monotorr.com/mcp` on authorization and token requests; mapped to API registration. Never strip/rewrite it in a proxy. |
| Audience | Accept only API GUID `A` in v2 access tokens; reject client/Graph/Monotorr audiences. |
| Issuer and tenant | Exact `https://login.microsoftonline.com/T/v2.0`, mandatory `tid=T`; no `common` issuer wildcard. |
| Scopes | Full API scope requested; exact short `scp` checked. OIDC scopes describe identity, not permission to read CW. |
| Offline access | Request `offline_access`; ChatGPT holds/refreshes tokens. Verify issuance and refresh; no API refresh-token storage. |
| Tool metadata | Declare OAuth for every existing tool; no `noauth`. Add backward-compatible mirror and truthful read-only annotations. |
| HTTP challenge | Missing/invalid token: 401 Bearer challenge with resource metadata and read scope. Insufficient scope: 403 with `insufficient_scope`. |
| MCP challenge | Tool-level auth error uses `isError` and `_meta["mcp/www_authenticate"]` with safe error/description when a tool-level reauthorization signal is needed. |
| Every request | Validate before MCP handling, including initialization/list/resource/tool requests; never trust a session ID as authorization. |

Registration ordering, each-request bearer use and mandatory PKCE discovery are from [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). Discovery fields follow [RFC 8414](https://www.rfc-editor.org/rfc/rfc8414.html), and 401/403 challenges follow [RFC 6750](https://www.rfc-editor.org/rfc/rfc6750.html). Tool metadata and its compatibility mirror follow [OpenAI tool reference](https://developers.openai.com/plugins/reference); tool-level linking signals follow [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

Current callbacks are conditional: providers meeting RFC 9207 response-issuer requirements can use `https://chatgpt.com/connector_platform_oauth_redirect`; otherwise ChatGPT uses `https://chatgpt.com/connector/oauth/{callback_id}`. Older connections can retain the stable callback. Do not set `authorization_response_iss_parameter_supported=true` unless the provider actually returns the correct `iss` on successful and error callbacks. [OpenAI callback change](https://developers.openai.com/plugins/changelog). CIMD uses a metadata URL as the client ID and can negotiate `none` or `private_key_jwt`; it is not the proposed Entra path. [OpenAI authentication](https://developers.openai.com/plugins/build/auth).

Transport identification is separate from user authorization. OpenAI documents an OpenAI-managed mTLS certificate for ChatGPT requests; edge validation is optional defense in depth to evaluate with the selected Azure ingress. Never replace user OAuth with an IP allowlist or certificate identity. [OpenAI client authentication](https://developers.openai.com/plugins/build/auth), [OpenAI IP guidance](https://developers.openai.com/api/docs/guides/ip-addresses).

## Repository Changes Required

These are proposed future changes, not implemented by this design pass. They map to `createHttpHandler({ authenticate, configProvider, allowedOrigins })` described in [PHASE1_HARDENING.md](PHASE1_HARDENING.md).

1. **`src/auth/types.ts`:** separate API ID, client ID, resource URL and issuer configuration. Replace the ambiguous legacy `clientId`/extra audiences/static-token fields with explicit strict settings. Model a request-local validated identity plus an auth failure category; retain no raw error data.
2. **`src/auth/middleware.ts`:** reuse JOSE JWKS/signature primitives. Restrict algorithms and the one tenant/issuer/API audience; require expiration/version/tenant, delegated scope, allowed client and staff role. Remove opportunistic audience retries and conditional-only tenant checks. Resolve keys from trusted configuration, never token-supplied URLs. Cache signing keys, but authorize every request.
3. **`src/index.ts`:** compose a fully configured Entra authenticator and pass it into both `requireHttpAuthentication` and `createHttpHandler`. Validate settings before listen; retain fail-closed startup on missing/invalid config. Never enable through an unvalidated boolean alone.
4. **`src/http-server.ts`:** serve the static public resource metadata before the `/mcp` auth gate. Keep all MCP requests behind the gate. Replace the current bare 401 with an RFC Bearer challenge. Preserve 401 versus 403; expected auth failures should not fall into the current generic 500 catch. Evolve the boolean-only callback to a typed identity/result or a narrow adapter that preserves these distinctions. Retain provider ordering, header/Origin protections and HTTPS requirements.
5. **Request context:** attach validated SDK-compatible auth information to `req.auth` before SDK handling; the installed Node transport reads that property and passes `authInfo` to handlers. Keep identity request-local, not in process globals or model arguments. Wrap tool authorization checks around this context; resolve `configProvider` only after authorization. No Key Vault implementation is part of this change.
6. **`src/mcp-server.ts`, tool registrations:** declare the read scope on all 39 tools, mirror `securitySchemes` in `_meta`, preserve UI metadata and schemas, and add truthful `readOnlyHint: true`/`destructiveHint: false`. Do not restore the removed write tools. Centralize the scope/role policy rather than duplicate JWT code per tool.
7. **SDK compatibility:** installed SDK 1.32.0 `registerTool` and its `tools/list` implementation do not expose/emit a top-level `securitySchemes` field; `_meta` is supported. Merely casting the documented config to an unrestricted type will not make the SDK serialize that field. Select a supported compatibility helper/version or an explicit descriptor adapter, test actual wire output, and preserve the documented `_meta` mirror. Treat acceptance of mirror-only descriptors as a live compatibility question.
8. **Tool-level linking:** the present all-request gate returns before any handler can emit an MCP challenge. Start with normal endpoint-level OAuth linking plus the strict gate; test expired-link recovery. For an authorized tool invocation that later requires reauthorization, return a safe `_meta["mcp/www_authenticate"]` result. If ChatGPT requires anonymous metadata initialization for its tool-linking UI, stop for a separately reviewed metadata-only path; do not open unauthenticated tool execution or weaken the existing boundary by assumption.
9. **`src/auth/routes.ts`:** keep legacy OAuth proxy/DCR handlers unmounted. Its existing resource metadata incorrectly points at the local server as issuer for a direct design; replace only with direct-Entra resource metadata when implementing. Do not mount its local authorize/token/register routes.
10. **Tests/documentation/config examples:** add discovery/challenge tests, strict JWT negative cases and role/scope/client separation tests; prove rejection happens before secret resolution/CW fetch; preserve 39-tool inventory. Update examples after a successful compatibility proof. Worker remains disabled unless separately integrated. Logs must never contain bearer tokens, CW secrets, OAuth codes, refresh tokens or raw JWTs.

No new resource-server database, login UI or custom OAuth protocol is required by the conditional direct design. These changes do not establish a working deployment until the external discovery and client-registration gates pass.

## What We Need to Configure Manually in Azure

After separate authorization to implement/provision:

- Identify the real tenant GUID and inspect its OIDC document before provisioning production apps; S256 advertisement is a stop condition.
- Create the two dedicated single-tenant registrations above. Configure v2 API tokens first, exact HTTPS identifier URI, admin-consent read scope and user role.
- Copy the exact callback and fixed-client options from the actual ChatGPT connection. Configure a Web redirect, supported confidential-client method, narrowly scoped delegated API permission and administrative consent/preauthorization. Do not enable implicit grants, password grants or general public-client fallbacks.
- Assign only the initial intended user to the API role; configure enterprise-app assignment and applicable MFA/Conditional Access. Check who can administer/consent/assign roles. Group assignment/licensing can wait until staff expansion.
- Associate existing verified publisher information with the new registrations if useful; set separate application owners. Verify actual tenant domain/publisher status rather than assume it from Monotorr's registrations.
- Configure the separate Azure service and ingress to route `/mcp` and its resource metadata to this application, with no Monotorr auth/cookie/audience sharing. Decide ingress and optional mTLS support; prevent alternate-host bypass and sensitive access logging.
- Supply nonsecret issuer/API/client/resource/scope/role settings to the application. Any future client credential and CW credential storage/rotation is a separate authorized implementation task; Key Vault is intentionally deferred here.

The API should not possess ChatGPT's refresh tokens, and ConnectWise should receive only the service's CW authentication. No Entra access token is passed to CW.

## What Must Be Tested Live

| Test / unknown | Pass condition |
| --- | --- |
| Actual tenant discovery and regional consistency | ChatGPT fetches the correct tenant issuer and sees advertised S256; no compatibility override needed. |
| Fixed-client setup | This ChatGPT account/workspace exposes predefined client configuration and accepts the Entra client authentication method. |
| Callback / issuer response mode | Exact callback works; state and any advertised response `iss` are validated; no wildcard or synthetic issuer. |
| Resource plus scope | Both code and token exchange preserve the resource; no AADSTS9010010; scope belongs to the API registration. |
| Tokens | v2 API-GUID audience, tenant/issuer, `azp`, delegated `scp`, staff `roles` and expiration appear as expected. ID token and Graph token are rejected by `/mcp`. |
| Authorization negatives | Wrong tenant/audience/client, malformed/unsigned/expired/future tokens, missing scope, missing role and app-only tokens cannot resolve CW secrets or execute a tool. |
| User restriction | Assigned initial user succeeds; unassigned employee and guest fail. Consent alone grants no staff role. |
| Refresh / policies | ChatGPT requests offline access, renews with the fixed client and recovers from revocation, MFA/session-policy changes and expired client credentials. Measure stale-token authorization window. |
| Linking signals | Initial HTTP challenge, authenticated initialization/listing, each tool's descriptor, expired-link recovery and any tool-level MCP challenge behave correctly. |
| SDK metadata | Real `tools/list` contains accepted OAuth security descriptors and still lists exactly the 39 read tools. |
| Ingress | Origin/Host routing, public metadata exceptions, TLS/JWKS access, optional OpenAI mTLS, unsupported HTTP methods, and alternate host protections work. |
| Operational separation | No Monotorr credentials/audiences accepted; no tokens/headers in app or ingress logs; CW permissions are independently read-only. |
| Account/workspace | Developer/private connection availability, admin policy, sharing and data-handling constraints match the intended account. Entra tenant restrictions alone do not bind a connection to one ChatGPT workspace. |

Only public documentation and public discovery were fetched here. No target-tenant credentials, authorization flow, ChatGPT connection, Azure inventory or CW call was tested. Azure hosting product, tenant policies, publisher associations, target user role and ChatGPT plan/workspace remain unverified. [OpenAI connection testing guidance](https://developers.openai.com/plugins/deploy/connect-chatgpt).

## Go / No-Go

**Conditional GO for a direct-Entra compatibility proof; NO-GO for claiming a clean, deployable direct integration today.** Entra's documented resource binding, code flow, API tokens and preregistration make it the simplest preferred architecture for one internal user. Native CIMD/DCR is not needed if the predefined-client path succeeds.

However, the fetched public discovery metadata does not satisfy mandatory S256 advertisement. Your tenant-specific result and ChatGPT's exact fixed-client exchange have not been validated. Those are acceptance gates, not details to bypass. If both pass, proceed with the resource-server changes listed above and keep Entra as the sole authorization server. If either fails, pause and evaluate a maintained Entra-federated MCP authorization solution separately. Leave the current fail-closed HTTP behavior intact until the gates and negative security tests pass.
