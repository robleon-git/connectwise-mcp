# Stage B: ConnectWise Key Vault loader

This implementation is prepared locally, not deployed. Run the commands below only after reviewing/authorizing the Stage B deployment. The MCP application, identity and dedicated vault remain separate from Monotorr application configuration, although they share its Azure tenant/resource group. No console UI, database, Descope policy change, Microsoft Graph permission or extra MCP write tool is required.

## Configuration contract

| Setting | Contract |
| --- | --- |
| `CW_CONFIG_SOURCE` | `env` (default, existing local behavior) or `key-vault` (hosted Stage B) |
| `CW_KEY_VAULT_URI` | Nonsecret `https://<vault-name>.vault.azure.net`, Azure public cloud; required for Vault mode |
| `CW_MANAGE_URL` | Nonsecret HTTPS ConnectWise base URL; explicit in Vault mode, existing NA default in env mode |
| `CW_MANAGE_COMPANY_ID` | Nonsecret ConnectWise company identifier; required |
| `CW_MANAGE_CLIENT_ID` | Nonsecret ConnectWise Developer Portal client ID; required; not an Entra OAuth client ID |
| `CW_MANAGE_PUBLIC_KEY` / `CW_MANAGE_PRIVATE_KEY` | Existing local compatibility inputs only; never used as fallback in Vault mode |
| `CW_MANAGE_REJECT_UNAUTHORIZED` | Existing default verified TLS remains; Vault mode rejects `false` |
| Vault `connectwise-public-key` | ConnectWise API member public key (credential material) |
| Vault `connectwise-private-key` | ConnectWise API member private key (credential material) |

`src/config-loader.ts` is the only Vault boundary and implements the existing `ConfigProvider` interface. The Node HTTP handler resolves it only after MCP authentication; the stdio entrypoint also uses it. Other read-tool handlers and the ConnectWise client have no Key Vault dependency. Azure SDKs are imported lazily only when Vault-mode configuration is complete. Production uses `ManagedIdentityCredential` with the Container App's system-assigned identity, without a CLI/client-secret fallback. Nonproduction local Vault testing uses `DefaultAzureCredential`; use the standard Azure CLI sign-in and grant that developer only the required vault access. No app registration/client secret is added.

Vault URI and ConnectWise HTTPS configuration are validated before secret lookup. The SDK retrieves only the two fixed secret names; it never creates/lists/deletes secrets. It preserves Key Vault challenge-resource verification, disables redirects, limits retries, supplies a 10-second abort signal and suppresses identity/secret SDK logging sinks. SDK error objects never leave the loader. Positive and absent snapshots expire after 60 seconds in memory, concurrent loads are coalesced, and no expired snapshot is reused on error. There is no token/secret persistence or background telemetry integration. Standard Azure service requests/SDK user-agent metadata go to Azure as part of Vault authentication/access.

Missing nonsecret inputs, absent/empty keys or the exact noncredential placeholder `__CONNECTWISE_NOT_CONFIGURED__` produce null configuration and preserve Stage A: one `cw_test_connection`, the unchanged missing-credentials diagnostic, no ConnectWise client and no API call. Vault 404 is treated as missing; permission/network/identity failures are sanitized configuration errors, not fallback to local keys. The authenticated HTTP request fails closed with 500 if Vault resolution fails; `/health` remains a process-health check and does not access the vault. Invalid source/URL/TLS settings fail closed.

With complete configuration, the server exposes **39 read-only tools total, including `cw_test_connection`**, not 40. Zero removed write tools return. `cw_test_connection` uses existing GET `/system/info` and discards the API response body. It returns `{"connected":true}` on success or `isError: true` with `{"connected":false,"error":"authentication_failed","httpStatus":401}` (403 likewise), a sanitized status for other HTTP failures, or generic `connection_failed` for network errors. It never logs/returns credentials, headers, raw errors or licensing/customer data. Other read tool behavior is unchanged.

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
CW_CLIENT_ID='<ConnectWise-Developer-Portal-client-id>'
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

Those literal values are deliberately noncredentials. The loader recognizes them and never sends them to ConnectWise. Only run placeholder creation on the new dedicated vault; do not overwrite previously populated keys. Do not disable the placeholders: disabled secrets can return access errors rather than 404. In Azure portal → your dedicated Key Vault → Secrets, create a new **enabled** version of each named secret with the real corresponding API key. Do not paste the values into the shell, repository, MCP caller, logs or documentation. The administrator creates the dedicated ConnectWise API member/read-only role and obtains the pair independently. Supply the server URL, company ID and Developer Portal client ID above; these are separate from the OAuth configuration.

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

## References and validation

Official packages: [Key Vault Secrets SDK](https://learn.microsoft.com/en-us/javascript/api/overview/azure/keyvault-secrets-readme?view=azure-node-latest), [Azure Identity SDK](https://learn.microsoft.com/en-us/javascript/api/overview/azure/identity-readme?view=azure-node-latest). Commands follow the [Key Vault CLI](https://learn.microsoft.com/en-us/cli/azure/keyvault?view=azure-cli-latest), [Container App identity CLI](https://learn.microsoft.com/en-us/cli/azure/containerapp/identity?view=azure-cli-latest) and [ACR build CLI](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest).

Focused tests use only generated/synthetic canaries and mocked SDK/HTTP responses; no live secrets are written or requested. The live managed-identity/Vault RBAC/GET check remains a manual Stage B gate. Dependencies added: `@azure/identity` 4.13.3 and `@azure/keyvault-secrets` 4.11.2. The compatible transitive `proxy-addr` patch 2.0.7 → 2.0.8 was also applied to remove the previously identified production advisory. No Azure command in this document was executed during implementation.

Validation on 2026-10-06: `npm run build:ui`, `npm run build`, `npm run lint`, `npm test` (12 files, 244 passed, 0 failed), `npm audit --omit=dev` (0 vulnerabilities), and `git diff --check` all exited 0. The runbook's shell blocks also passed `bash -n`. No commit, push, deployment or Azure/Descope mutation occurred; earlier uncommitted local operator-helper work was preserved.
