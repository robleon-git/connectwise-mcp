import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
export const execute = promisify(execFile);
export async function configuration(path = "deployment/azure/config.json") {
    const c = JSON.parse(await readFile(path, "utf8"));
    const expected = { subscriptionId: "08a97e42-1e1f-4f33-95dc-36af13337091", tenantId: "ad6bf531-194d-4880-8baa-013ab8eab0e8", resourceGroup: "monotorr-connectwise-prod-rg", sharedResourceGroup: "monotorr-dev-eastus-rg", environment: "monotorr-prod-aca-env", registry: "monotorrdevacr6689", vault: "cw-mcp-kv", controlApi: "connectwise-control-api", migrationJob: "connectwise-migrate", portal: "connectwise-portal", bootstrapJob: "connectwise-bootstrap", virtualNetwork: "monotorr-prod-vnet", privateEndpointSubnet: "snet-monotorr-private-endpoints", privateEndpoint: "pe-connectwise-prod-postgres", privateDnsZone: "privatelink.postgres.database.azure.com", database: "connectwise", location: "eastus", mcpResource: "https://api.monotorr.com/mcp", portalOrigin: "https://portal.monotorr.com", controlApiOrigin: "https://api.monotorr.com", controlApiPrefix: "/connectwise/v1", customerLoginClientId: "4405ef16-dc89-4385-8a84-cda2a52274cf" };
    if (Object.keys(c).some(k => !Object.hasOwn(expected, k) && k !== "databaseServer") || Object.entries(expected).some(([k, v]) => c[k] !== v) || c.databaseServer !== "monotorr-cw-db-01")
        throw new Error("invalid_delivery_target");
    return Object.freeze(c);
}
export async function az(args, { timeout = 120000 } = {}) {
    try {
        return (await execute("az", [...args, "--only-show-errors"], { timeout, maxBuffer: 1024 * 1024, env: { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no" } })).stdout.trim();
    }
    catch {
        throw new Error("azure_operation_failed");
    }
}
export function immutableImage(c, image) {
    if (typeof image !== "string" || !new RegExp(`^${c.registry}\\.azurecr\\.io/connectwise-control-api@sha256:[a-f0-9]{64}$`).test(image))
        throw new Error("invalid_image");
    return image;
}
export async function assertSubscription(c) {
    const account = JSON.parse(await az(["account", "show", "--query", "{id:id,tenant:tenantId}", "-o", "json"]));
    if (account.id !== c.subscriptionId || account.tenant !== c.tenantId)
        throw new Error("wrong_subscription");
}
export function needsDogfood(paths) {
    return paths.some(p => /^src\/(auth\/|accounts\/|entitlements\/|connections\/|tools\/)/.test(p) || ["src/index.ts", "src/http-server.ts", "src/mcp-server.ts", "src/config.ts", "src/config-loader.ts", "src/api-client.ts"].includes(p));
}
export function featureOnlyDeployment(component) { if (!["control-api", "portal"].includes(component))
    throw new Error("mcp_deployment_not_authorized_in_phase0"); }
