# Stage B: ConnectWise Key Vault loader

Stage B is deployed and verified: the registered Monotorr integration Client ID enables successful ConnectWise authentication, `cw_test_connection` returns `connected:true`, and the live MCP inventory contains 39 read-only tools. The provisioning commands below are retained as a reference; do not rerun them against existing resources without explicit authorization. The MCP application, identity and dedicated vault remain separate from Monotorr application configuration, although they share its Azure tenant/resource group. No console UI, database, Descope policy change, Microsoft Graph permission or extra MCP write tool is required.

## Configuration contract

| Setting | Contract |
| --- | --- |
| `CW_CONFIG_SOURCE` | `env` (default, existing local behavior) or `key-vault` (hosted Stage B) |
| `CW_KEY_VAULT_URI` | Nonsecret `https://<vault-name>.vault.azure.net`, Azure public cloud; required for Vault mode |
| `CW_MANAGE_URL` | Nonsecret HTTPS ConnectWise base URL; explicit in Vault mode, existing NA default in env mode |
| `CW_MANAGE_COMPANY_ID` | Nonsecret ConnectWise company identifier; required |
| `CW_MANAGE_CLIENT_ID` | Registered nonsecret Monotorr-owned integration Client ID; required for successful authentication in the current Monotorr deployment. The shared loader/client still supports omission for explicit diagnostic comparisons |
| `CW_MANAGE_PUBLIC_KEY` / `CW_MANAGE_PRIVATE_KEY` | Existing local compatibility inputs only; never used as fallback in Vault mode |
| `CW_MANAGE_REJECT_UNAUTHORIZED` | Existing default verified TLS remains; Vault mode rejects `false` |
| Vault `connectwise-public-key` | ConnectWise API member public key (credential material) |
| Vault `connectwise-private-key` | ConnectWise API member private key (credential material) |

`src/config-loader.ts` is the only Vault boundary and implements the existing `ConfigProvider` interface. The Node HTTP handler resolves it only after MCP authentication; the stdio entrypoint also uses it. Other read-tool handlers and the ConnectWise client have no Key Vault dependency. Azure SDKs are imported lazily only when Vault-mode configuration is complete. Production uses `ManagedIdentityCredential` with the Container App's system-assigned identity, without a CLI/client-secret fallback. Nonproduction local Vault testing uses `DefaultAzureCredential`; use the standard Azure CLI sign-in and grant that developer only the required vault access. No app registration/client secret is added.

Vault URI and ConnectWise HTTPS configuration are validated before secret lookup. The SDK retrieves only the two fixed secret names; it never creates/lists/deletes secrets. It preserves Key Vault challenge-resource verification, disables redirects, limits retries, supplies a 10-second abort signal and suppresses identity/secret SDK logging sinks. SDK error objects never leave the loader. Positive and absent snapshots expire after 60 seconds in memory, concurrent loads are coalesced, and no expired snapshot is reused on error. There is no token/secret persistence or background telemetry integration. Standard Azure service requests/SDK user-agent metadata go to Azure as part of Vault authentication/access.

Missing nonsecret inputs, absent/empty keys or the exact noncredential placeholder `__CONNECTWISE_NOT_CONFIGURED__` produce null configuration and preserve Stage A: one `cw_test_connection`, the unchanged missing-credentials diagnostic, no ConnectWise client and no API call. Vault 404 is treated as missing; permission/network/identity failures are sanitized configuration errors, not fallback to local keys. The authenticated HTTP request fails closed with 500 if Vault resolution fails; `/health` remains a process-health check and does not access the vault. Invalid source/URL/TLS settings fail closed.

With complete configuration, the server exposes **39 read-only tools total, including `cw_test_connection`**, not 40. Zero removed write tools return. `cw_test_connection` uses existing GET `/system/info` and discards the API response body. It returns `{"connected":true}` on success or `isError: true` with `{"connected":false,"error":"authentication_failed","httpStatus":401}` (403 likewise), a sanitized status for other HTTP failures, or generic `connection_failed` for network errors. It never logs/returns credentials, headers, raw errors or licensing/customer data. Other read tool behavior is unchanged.

## Verified API-member authentication contract

The client constructs `Authorization: Basic base64(CompanyID+PublicKey:PrivateKey)` unchanged. It sends `clientId` in a separate HTTP header only when a nonempty integration Client ID is configured. Company ID identifies the ConnectWise company; the member's key pair authenticates its API access. No API Member ID/username is read or combined with the public key. Create and authorize the dedicated read-only API member administratively, but do not add `CW_MANAGE_MEMBER_ID` to runtime configuration.

Required customer/runtime inputs are the ConnectWise server URL, Company ID, API-member public key and API-member private key. Vault mode also requires the dedicated `CW_KEY_VAULT_URI` and `CW_CONFIG_SOURCE=key-vault`. Existing local env mode retains its NA URL default. Monotorr supplies the globally registered operator integration Client ID through `CW_MANAGE_CLIENT_ID`; it is required for the proven current deployment. Customers supply only the four connection inputs, not their own integration Client ID. It is not part of Basic authentication, either API key, an API Member ID or an OAuth client ID. The loader's normalized object remains `{baseUrl, companyId, publicKey, privateKey, clientId, rejectUnauthorized}`; Client ID is trimmed, with absent/empty/whitespace-only input represented as `undefined`. No empty header or generated/default ID is sent. Local environment support and the two fixed Key Vault secret names remain unchanged.

Customers do not need a Developer Portal account for our current onboarding path. Registered integration Client ID provisioning belongs to Monotorr as the service operator. ConnectWise's published [Developer Network registration terms](https://register.developer.connectwise.com/) prohibit requiring customers to create a separate developer account or Client ID to use an integration. This separates integration provisioning from customer onboarding; it does not prove every server accepts omission of the header.

Historical no-Client-ID tests returned HTTP 401 on `/system/info` and `/company/companies`. The subsequent registered-Client-ID configuration succeeded and is the production baseline. Keep the header configured for normal diagnostics; omission is now an explicit historical comparison, not the deployment acceptance gate. Do not weaken Descope authorization, ConnectWise role restrictions or TLS, invent a GUID, or substitute an API Member ID.

## Operator prerequisites

Use the intended subscription, access to the existing resource group/Container App/ACR, and permission to create vault resources and role assignments. Resource Contributor alone is insufficient to grant RBAC roles; an authorized Owner or appropriate RBAC administrator must run those commands. The operator needs Key Vault Secrets Officer to create placeholders and manually enter/rotate keys. The application receives only Key Vault Secrets User on its dedicated vault. Azure recommends a vault per application/environment with vault-scoped roles ([RBAC guide](https://learn.microsoft.com/en-us/azure/key-vault/general/rbac-guide)); do not reuse a vault containing Monotorr secrets.

Run each command/block only after the previous one succeeds. Do not continue through RBAC propagation errors, failed builds, missing digests or failed activation. Copy only the nonsecret setup inputs; real API keys are entered in the portal, never the shell.

Supply these nonsecret values in the shell. No API key belongs in these variables, an env file, a command, build argument, repository, screenshot or pasted output:

```sh
cd /Users/rleon/Development/connectwise-mcp
CW_SUBSCRIPTION_ID='<existing-subscription-id>'
CW_VAULT_NAME='<globally-unique-dedicated-vault-name>'
CW_OPERATOR_OBJECT_ID='<your-Entra-user-object-id-from-Azure-portal>'
CW_SERVER_URL='<https://your-ConnectWise-server>'
CW_COMPANY_ID='<ConnectWise-company-id>'
CW_CLIENT_ID='<registered-Monotorr-integration-client-id>' # Required for the current deployment; nonsecret.
CW_IMAGE_TAG='<new-unique-reviewed-stageb-build-tag>'
CW_RG='monotorr-dev-eastus-rg'
CW_APP='connectwise-mcp-pilot'
CW_ACR='monotorrdevacr6689'
az account set --subscription "$CW_SUBSCRIPTION_ID"
```

The vault name must be 3–24 characters, start with a letter, contain only letters/digits/hyphens and be globally unique; use lowercase and avoid consecutive hyphens. The image tag must refer to the reviewed Stage B changes; do not overwrite `b4cd675` or deploy that earlier image expecting the new loader. Real keys are entered later in the Azure portal. The operator object ID is supplied manually so role assignment does not require a Graph lookup.

## Create the dedicated vault and identity

```sh
az keyvault create --name "$CW_VAULT_NAME" --resource-group "$CW_RG" \
  --location eastus --sku standard --enable-rbac-authorization true \
  --enable-purge-protection true --retention-days 90 --output none

CW_VAULT_ID=$(az keyvault show --name "$CW_VAULT_NAME" --query id --output tsv)
CW_VAULT_URI=$(az keyvault show --name "$CW_VAULT_NAME" --query properties.vaultUri --output tsv)
CW_PRINCIPAL_ID=$(az containerapp show --name "$CW_APP" --resource-group "$CW_RG" \
  --query identity.principalId --output tsv)
if [ -z "$CW_PRINCIPAL_ID" ] || [ "$CW_PRINCIPAL_ID" = "None" ] || [ "$CW_PRINCIPAL_ID" = "null" ]; then
  az containerapp identity assign --name "$CW_APP" --resource-group "$CW_RG" \
    --system-assigned --output none
  CW_PRINCIPAL_ID=$(az containerapp show --name "$CW_APP" --resource-group "$CW_RG" \
    --query identity.principalId --output tsv)
fi

az role assignment create --assignee-object-id "$CW_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role 4633458b-17de-408a-b874-0445c86b69e6 --scope "$CW_VAULT_ID" --output none

az role assignment create --assignee-object-id "$CW_OPERATOR_OBJECT_ID" \
  --assignee-principal-type User \
  --role b86a8fe4-44ce-4948-aee5-eccb2c155cd7 --scope "$CW_VAULT_ID" --output none
```

The first role is **Key Vault Secrets User**, read-only; the second is the operator's **Key Vault Secrets Officer**, not an application role. Wait for RBAC propagation before the next step (it can take several minutes). Vault creation uses its standard HTTPS data endpoint, RBAC and purge protection. Public endpoint access still requires Entra authentication/RBAC; if organizational policy requires private networking, provision the approved VNet/private endpoint path separately before using Vault mode. Do not change unrelated network settings to bypass a denial. This loader currently validates Azure public-cloud vault URLs; sovereign clouds require a reviewed extension.

## Create placeholders and enter the real keys manually

```sh
az keyvault secret set --vault-name "$CW_VAULT_NAME" --name connectwise-public-key \
  --value '__CONNECTWISE_NOT_CONFIGURED__' --output none
az keyvault secret set --vault-name "$CW_VAULT_NAME" --name connectwise-private-key \
  --value '__CONNECTWISE_NOT_CONFIGURED__' --output none
```

Those literal values are deliberately noncredentials. The loader recognizes them and never sends them to ConnectWise. Only run placeholder creation on the new dedicated vault; do not overwrite previously populated keys. Do not disable the placeholders: disabled secrets can return access errors rather than 404. In Azure portal → your dedicated Key Vault → Secrets, create a new **enabled** version of each named secret with the real corresponding API key. Do not paste the values into the shell, repository, MCP caller, logs or documentation. The administrator creates the dedicated ConnectWise API member/read-only role and obtains the pair independently. Supply the server URL, company ID and registered Monotorr integration Client ID for the current production configuration. These are separate from the OAuth configuration.

If you intentionally deploy with placeholders first, confirm the original Stage A behavior. Replacing both placeholders with real values transitions the loader after its next cache expiry (at most 60 seconds for the loader snapshot); no auth/routing change or redeploy is needed for that rotation. Avoid MCP calls between updating the two key versions, since a transient mixed pair fails authentication. Do not treat a loader cache as a persistent secret store or a substitute for key rotation/revocation.

## Build and deploy the reviewed image manually

ACR builds on the specified architecture to avoid the earlier ARM64 activation failure. The Dockerfile compiles the new loader into production `dist` and prunes dev dependencies. No secret enters the build context; `.dockerignore` already excludes `.env*` except the empty/nonsecret example.

```sh
az acr build --registry "$CW_ACR" --image "connectwise-mcp:$CW_IMAGE_TAG" \
  --platform linux/amd64 --no-logs .
CW_IMAGE_DIGEST=$(az acr manifest show-metadata --registry "$CW_ACR" \
  --name "connectwise-mcp:$CW_IMAGE_TAG" --query digest --output tsv)

az containerapp update --name "$CW_APP" --resource-group "$CW_RG" \
  --image "$CW_ACR.azurecr.io/connectwise-mcp@$CW_IMAGE_DIGEST" \
  --set-env-vars NODE_ENV=production CW_CONFIG_SOURCE=key-vault \
    "CW_KEY_VAULT_URI=$CW_VAULT_URI" "CW_MANAGE_URL=$CW_SERVER_URL" \
    "CW_MANAGE_COMPANY_ID=$CW_COMPANY_ID" "CW_MANAGE_CLIENT_ID=$CW_CLIENT_ID" \
    CW_MANAGE_REJECT_UNAUTHORIZED=true --output none

CW_READY_REVISION=$(az containerapp show --name "$CW_APP" --resource-group "$CW_RG" \
  --query properties.latestReadyRevisionName --output tsv)
az containerapp revision show --name "$CW_APP" --resource-group "$CW_RG" \
  --revision "$CW_READY_REVISION" \
  --query '{name:name,state:properties.runningState,health:properties.healthState,image:properties.template.containers[0].image}' \
  --output json
```

`--set-env-vars` merges these CW settings; do not use replacement flags, change Descope settings/approved-user mapping, remove existing auth settings or alter ingress/traffic. Existing ACR pull configuration is preserved. Compare the ready revision's image to the new digest: a failed activation can leave the previous Stage A revision serving traffic. If mismatch/unhealthy, stop; do not claim Stage B passed. No commands here create a new tenant, app registration, database, configuration console or OAuth client secret.

After the ready digest matches, run `npm run diagnose:live-mcp -- --azure-logs`. With both real keys present it should list exactly 39 tools, all read-only. Invoke `cw_test_connection` once from the authenticated client/ChatGPT; expected result is sanitized connectivity success or failure. A CW 401/403 is a read-only role/key/server/company/client configuration problem to investigate with the administrator, not grounds to weaken authentication or TLS. Public on-prem access requires a valid HTTPS certificate and outbound connectivity from the Container App; the minimal loader does not configure that network or change CW permissions.

## Local direct authentication diagnostic

Use this local-only helper to inspect the current request shape and HTTP status independently of MCP. It uses the existing loader, fixed Vault secret names and local `DefaultAzureCredential` path; it never copies keys to the shell. Sign in with `az login` if needed, using an identity that already has permission to read this dedicated vault. Do not grant broader permissions or print secret values to troubleshoot a denial.

For the current pilot, avoid URL-copying/Markdown formatting issues with `npm run diagnose:cw-auth -- --pilot`. This explicit local shortcut selects the already supplied nonsecret server URL `https://connect.connections.com`, Company ID `connections` and Vault URI `https://cw-mcp-kv.vault.azure.net`, and preserves the configured `CW_MANAGE_CLIENT_ID`. The shortcut does not retrieve the Client ID from Azure: supply it locally as nonsecret configuration or use `--client-id <registered-Monotorr-integration-client-id>`. It never changes Azure or the parent environment. Configuration failures include fixed reason labels: `invalid_connectwise_url`, `invalid_key_vault_uri`, `missing_runtime_inputs`, `missing_or_placeholder_secrets`, or `key_vault_access_failed`. The last label covers identity, permission and Vault network failures; it does not assert which caused the failure or expose raw SDK errors.

```sh
cd /Users/rleon/Development/connectwise-mcp
npm run diagnose:cw-auth -- --pilot --client-id '<registered-Monotorr-integration-client-id>'
```

Replace the placeholder with the registered nonsecret ID; do not paste angle brackets literally. Alternatively export `CW_MANAGE_CLIENT_ID` once and run `npm run diagnose:cw-auth -- --pilot`. For another server, supply `CW_MANAGE_URL`, `CW_MANAGE_COMPANY_ID` and `CW_KEY_VAULT_URI` in the process environment and omit `--pilot`. No key is copied out of Vault.

The supported npm command always runs `npm run build` first, rebuilding the imported production `dist/api-client.js` and `dist/config-loader.js` modules. `npm test -- src/__tests__/diagnose-cw-auth.test.ts src/__tests__/api-client-tls.test.ts` and `npm test` also rebuild first; no pre-existing `dist` is required after `npm ci`. Direct `node scripts/diagnose-cw-auth.mjs` or `npx vitest` bypasses these npm hooks and requires an explicit fresh `npm run build`; use the npm commands for the deterministic operator/test workflow. `npm run test:watch` builds on startup; restart it after production TypeScript changes so the imported compiled modules are refreshed.

For the historical no-ID baseline only, run `npm run diagnose:cw-auth -- --pilot --without-client-id`. This clears the ID only in the diagnostic's local snapshot and never changes the parent environment or production settings. It cannot be combined with `--client-id`. The default and `--pilot` retain any configured ID; `--client-id` explicitly overrides it locally. Only `clientIdHeaderPresent` is reported, never the value.

The helper forces only its local loader snapshot to Vault mode and development identity selection; it does not mutate `process.env` or production configuration. API keys in local environment variables are not a fallback.

The standalone process temporarily observes the production client's fetch call after Vault retrieval, restores fetch afterward, and allows exactly one direct GET `/system/info`. This observes the actual production Authorization construction instead of reimplementing it. The accepted final path is `/v4_6_release/apis/3.0/system/info`; unexpected extra segments, queries, insecure TLS or other request shapes abort before sending. Redirects are rejected, the request has a 15-second timeout, and there are no alternate auth attempts or ConnectWise retries. Vault reads retain the existing SDK retry policy.

Only hostname, fixed paths, request-shape booleans and HTTP status are printed in normal mode. Deep mode also reports the strictly allowlisted response metadata below. Response streams are discarded without reading bodies. Errors are fixed stage labels, never raw objects. A 401 or 403 is evidence of rejection of this request, not by itself proof that Client ID is its cause. Exit status is zero for HTTP 2xx and nonzero for configuration/network failures or other statuses. No live request is executed by tests or by adding this helper.

### Deep structural inspection (local only)

Run `npm run diagnose:cw-auth -- --pilot --deep` for the same single GET with additional boolean checks. No credential normalization, authentication scheme, headers, redirects, path, TLS, MCP behavior or production code is changed. Keys remain only in memory. Deep mode reports leading/trailing whitespace, CR/LF, whether trimming would change a key, boundary quotes and URL-encoding markers. It never prints key values, lengths, hashes, prefixes/suffixes, the Authorization value or response data. Header reporting uses fixed categories (`application/json`, `connectwise_vendor_json`, `other_or_absent`), not arbitrary header values. User-Agent is reported only as explicitly present/absent; runtime-injected headers cannot be observed at this pre-fetch boundary.

Exact production encoding is `Basic ` followed by one Base64 encoding of the UTF-8 string `CompanyID + "+" + PublicKey + ":" + PrivateKey`. The `+` is a literal delimiter, not merely string-concatenation notation: the pilot structurally sends `connections+<PUBLIC_KEY>:<PRIVATE_KEY>`. There is no Member ID, URL encoding, double Base64 or duplicate Basic prefix. This code is unchanged from the initial inherited `b2ed6da` implementation and locally available `upstream/main`. The [connectwise-rest library's own source](https://github.com/covenanttechnologysolutions/connectwise-rest/blob/master/src/Manage.ts) independently uses the same literal-plus construction; its other headers/client requirements are not adopted here. The same client auth construction is used for cloud and on-prem; the hostname/API entry point differ, and some cloud deployments use version-specific entry points. This review does not prove every target server accepts this path or every optional header choice.

The env loader, normalized config and client preserve public/private key strings verbatim. Vault loading checks `trim()` only for completeness/placeholder detection and also preserves the original keys. It does not remove quotes or whitespace. Client ID is the only credential-adjacent field trimmed by shared normalization. Deep mode detects problematic key formatting without correcting it or trying alternate credentials. The production request has `Accept: application/json`, `Content-Type: application/json`, optional `clientId`, no query and `redirect: error`.

Vendor onboarding fields alone do not prove which headers that vendor sends internally. The reviewed [IT Glue integration guide](https://help.itglue.kaseya.com/help/Content/1-admin/psa-integrations/integrating-with-connectwise-manage.html) describes its Client ID field but does not explicitly label that field optional in the retrieved text. This does not make Client ID the assumed cause of this pilot's 401. During historical no-ID troubleshooting, clean structural flags did not establish the precise rejection cause. Subsequent success with the registered Client ID establishes the working current configuration; do not silently omit that header. Record only sanitized diagnostic facts and investigate with the ConnectWise administrator, without broadening roles or weakening TLS/authentication.

Historical no-ID local check on 2026-10-06: one GET reached `connect.connections.com` at the exact expected path and returned HTTP 401. Both keys and Company ID had no leading/trailing whitespace or CR/LF; keys had no boundary quotes or URL-encoding markers. The Basic prefix, single canonical Base64, literal plus separator and complete decoded payload matched production construction. `Accept` and `Content-Type` were `application/json`, Client ID was absent, there were no unexpected explicit headers/query/duplicate slashes, and redirects/TLS relaxation were disabled. Keys were preserved, not trimmed or rewritten. No response data or credentials were printed. This rules out the checked local formatting defects but does not prove the precise server-side rejection cause. Validation: both builds, lint, all 289 tests (13 files), production audit (zero vulnerabilities), script lint and whitespace checks passed. No commit, push, deployment or external configuration change occurred.

### Allowlisted response metadata and interpretation

The same `npm run diagnose:cw-auth -- --pilot --deep` invocation reports `responseContentType` and `responseBodyMediaType` as fixed categories derived solely from Content-Type (parameters discarded). This is the declared media type, not body inspection. `serverHeader` is a fixed known family or exact allowlisted version (for example `Microsoft-IIS/10.0`); arbitrary server strings/suffixes are never emitted. Unknown/absent values become `other`/`absent`.

`wwwAuthenticateSchemes` includes only the recognized names Basic, Digest, Bearer, Negotiate, NTLM and DPoP. The parser respects quoted commas/escapes, ignores parameters and unrecognized scheme names, and emits no realm/token/parameter values. An empty list does not prove there was no challenge. `locationHeaderPresent` reads only existence, never the Location value. `responseWasRedirect` summarizes the observed status/redirect flag; production's existing `redirect: error` is unchanged, so Node may reject a redirect before returning any response metadata. That case remains a sanitized network failure, without a second request.

`proxyHeaderNames` is restricted to fixed known names such as `x-azure-ref`, `x-arr-log-id`, `x-powered-by`, `via`, `x-cache`, `cf-ray` and `x-envoy-upstream-service-time`; values are not read. Arbitrary headers, Authorization, Set-Cookie and cookies are never enumerated or copied. The presence of these names suggests infrastructure involvement, not necessarily that it produced the rejection.

Interpretation remains separate from the JSON result:

| Response pattern | What it suggests; limits |
| --- | --- |
| HTML + IIS + Negotiate/NTLM | Windows/web-server authentication is a strong candidate before API-key validation. Confirm with IIS status/substatus and server logs. |
| HTML + Basic | Web-server/proxy Basic authentication is plausible, but Basic alone cannot distinguish it from application authentication. |
| JSON/vendor JSON, without Windows schemes | Application/API-layer rejection is more plausible; not proof the body is a ConnectWise error or that the credentials are incorrect. |
| Recognized proxy header names | A proxy handled the response. It may have generated the denial or forwarded it. |
| Location/redirect | Routing/login interception is plausible. Redirects remain blocked; no follow-up request is made. |

IIS may host ConnectWise itself, so `Server: Microsoft-IIS` alone cannot identify the rejecting layer. Authentication schemes are challenges rather than definitive component identities ([HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-11.6.1)); Negotiate/NTLM are associated with [Windows authentication in IIS](https://learn.microsoft.com/en-us/iis/configuration/system.webserver/security/authentication/windowsauthentication/). Use server-side correlation to establish the cause without exposing request credentials.

Production `src/api-client.ts` throws a sanitized status error on `!response.ok` before calling `response.json()`. It therefore discards a potentially useful ConnectWise error body. That deliberate boundary and production logging remain unchanged; the local helper also never reads that body.

Historical no-ID response-metadata check on 2026-10-06 used one GET and returned HTTP 401, declared `application/json`, `serverHeader: absent`, no recognized challenge schemes, no Location/redirect and no allowlisted proxy header names. This suggests application/API-layer rejection more than an ordinary IIS Windows-auth challenge, but does not establish the origin: intermediaries can return JSON or remove headers. No body was inspected. Final validation passed both builds, lint, all 308 tests across 13 files, production audit (zero vulnerabilities), script lint and `git diff --check`. No authentication behavior, external configuration, credentials or production logging changed.

### Compare one existing company-read endpoint

The local `--pilot` shortcut preserves an exported `CW_MANAGE_CLIENT_ID`. To explicitly supply the registered Monotorr ID without changing production configuration, use `npm run diagnose:cw-auth -- --pilot --endpoint companies --client-id <registered-Monotorr-integration-client-id>`. For a historical comparison only, use `npm run diagnose:cw-auth -- --pilot --endpoint companies --without-client-id`. Both pass through the existing loader and production client/header construction; the ID is never printed or persisted. `--deep` can be added without changing the one-request limit.

Run `npm run diagnose:cw-auth -- --pilot --endpoint companies` to select exactly GET `/company/companies?pageSize=1` instead of `/system/info`. Add `--deep` to retain the additional structural/response metadata. This is the endpoint used by existing `cw_search_companies`, with only `pageSize=1` and no explicit page parameter. The diagnostic still makes exactly one ConnectWise request, uses identical production loader/Key Vault/Basic auth/TLS, discards the entire body and prints only sanitized facts. The two explicit targets are `system-info` (default) and `companies`; no arbitrary endpoint/URL, conditions, extra queries or automatic fallback is allowed. The existing `--companies` shorthand remains an alias with this exact query. Company data is never printed. This local diagnostic flag does not change MCP or production configuration.

The result includes `diagnosticTarget`, boolean `queryParametersPresent` and fixed `pageSize: 1` for companies, plus safe Authorization-presence/Basic-scheme flags even without `--deep`. The existing `npm run diagnose:cw-auth -- --pilot --deep` still selects `/system/info`, with no query and unchanged production request construction.

HTTP 200 establishes successful access for this API member to the company-read route; if `/system/info` remains 401, investigate that check's specific availability/permissions. Another 401 does not isolate a `/system/info` problem: general authentication/routing or access denial remains possible. HTTP 403 indicates an access denial worth correlating with server logs, not permission to broaden the role. HTTP 404 makes this route/base-path/version suspect but is not conclusive because servers can mask access denials. The endpoint is an existing repository read, not independently proven accessible on this pilot until a live successful result is observed.

## Verify the complete connected read surface

The configured `createMcpServer` already registers the inherited 39 read-only tools; there is no additional activation flag or per-tool enablement change. Missing configuration still registers only `cw_test_connection`. All listed handlers use the production client's GET path, whose non-GET guard remains in place. API-member permissions still govern whether a particular read succeeds; exposing a tool does not grant ConnectWise permissions.

Run `npm run diagnose:live-mcp -- --expect-read-tools` for the existing browser OAuth/verified-token/SDK initialize/initialized/tools-list sequence. This diagnostic executes no ConnectWise tool and never reads CW credentials locally. It compares the returned inventory against the exact 39-name operator reference, rejecting missing/extra/write/duplicate names. PASS requires `mcpInitializeSucceeded: true`, `toolsListSucceeded: true`, `toolCount: 39` and `expectedReadToolSetMatched: true`. Inventory mismatch exits 4 with the sanitized stage `tool_inventory`. Add `--azure-logs` if the existing safe Azure console-log retrieval is needed. No deployment, OAuth policy or registration changes are made by this command. A stale ChatGPT inventory may require reconnecting/refreshing the connection after confirming the live inventory.

## References and validation

Official packages: [Key Vault Secrets SDK](https://learn.microsoft.com/en-us/javascript/api/overview/azure/keyvault-secrets-readme?view=azure-node-latest), [Azure Identity SDK](https://learn.microsoft.com/en-us/javascript/api/overview/azure/identity-readme?view=azure-node-latest). Commands follow the [Key Vault CLI](https://learn.microsoft.com/en-us/cli/azure/keyvault?view=azure-cli-latest), [Container App identity CLI](https://learn.microsoft.com/en-us/cli/azure/containerapp/identity?view=azure-cli-latest) and [ACR build CLI](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest).

Focused tests use only generated/synthetic canaries and mocked SDK/HTTP responses; no live secrets are written or requested. The live managed-identity/Vault RBAC/GET check remains a manual Stage B gate. Dependencies added: `@azure/identity` 4.13.3 and `@azure/keyvault-secrets` 4.11.2. The compatible transitive `proxy-addr` patch 2.0.7 → 2.0.8 was also applied to remove the previously identified production advisory. No Azure command in this document was executed during implementation.

Optional Client ID correction validated on 2026-10-06: `npm run build:ui`, `npm run build`, `npm run lint`, `npm test` (12 files, 259 passed, 0 failed), `npm audit --omit=dev` (0 vulnerabilities), and `git diff --check` all exited 0. The runbook's shell blocks also passed `bash -n`. No commit, push, deployment or Azure/Descope mutation occurred during this correction. That historical correction kept the shared client technically optional; later no-ID tests returned 401, while the current registered Monotorr Client ID configuration passed the live connection test. The current deployment requires that configured ID.

Operator diagnostic cleanup validation: the supported npm diagnostic and test commands rebuild production modules first. Focused diagnostic/TLS tests passed (82 tests), including a run with both compiled diagnostic imports removed before the build. The full regression suite passed (456 tests across 21 files), including disposable PostgreSQL 18 integration tests. UI build, TypeScript build, lint, production audit, full audit and whitespace checks passed; both audits reported zero vulnerabilities. No production entrypoint, authentication, Azure resource or deployment was changed.
