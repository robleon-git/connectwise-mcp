// Render exactly the two NEW product compute resources for review; no Azure write.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuration, immutableImage } from "./common.mjs";
export function bootstrapResource(c, image, purpose = "initial") {
    if (!["initial","mcp-reader"].includes(purpose)) throw new Error("invalid_bootstrap_purpose");
    immutableImage(c, image);
    const { job } = computeResources(c, image, []);
    // Dedicated one-use system identity: never borrow runtime/migrator Vault permissions.
    job.properties.template.containers[0].name = "connectwise-bootstrap";
    job.properties.template.containers[0].args = ["dist/database/bootstrap-cli.js"];
    job.properties.template.containers[0].env = [
        { name: "NODE_ENV", value: "production" },
        { name: "CW_DB_HOST", value: `${c.databaseServer}.postgres.database.azure.com` },
        { name: "CW_DB_NAME", value: "connectwise" },
        { name: "CW_DB_USER", value: "cw_bootstrap_admin" },
        { name: "CW_KEY_VAULT_URI", value: "https://cw-mcp-kv.vault.azure.net" },
        { name: "CW_BOOTSTRAP_CONFIRM", value: purpose === "initial" ? "INITIALIZE_CONNECTWISE_DATABASE" : "INITIALIZE_CONNECTWISE_MCP_READER" },
    ];
    return job;
}
export function computeResources(c, image, probes) {
    immutableImage(c, image);
    const base = `/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}/providers`;
    const environment = `${base}/Microsoft.App/managedEnvironments/${c.environment}`;
    const pull = `${base}/Microsoft.ManagedIdentity/userAssignedIdentities/connectwise-mcp-pull-id`;
    const identity = { type: "SystemAssigned, UserAssigned", userAssignedIdentities: { [pull]: {} } };
    const env = user => [{ name: "NODE_ENV", value: "production" }, { name: "CW_DB_HOST", value: `${c.databaseServer}.postgres.database.azure.com` }, { name: "CW_DB_NAME", value: c.database }, { name: "CW_DB_USER", value: user }, { name: "CW_DB_PASSWORD_SECRET", value: user === "cw_control" ? "cw-control-db-password" : "cw-migration-db-password" }, { name: "CW_KEY_VAULT_URI", value: `https://${c.vault}.vault.azure.net` }];
    const container = { name: c.controlApi, image, resources: { cpu: 0.5, memory: "1Gi" } };
    const registries = [{ server: `${c.registry}.azurecr.io`, identity: pull }];
    const api = { location: c.location, identity, properties: { managedEnvironmentId: environment, configuration: { activeRevisionsMode: "Multiple", registries, ingress: { external: true, allowInsecure: false, targetPort: 8080, transport: "auto", traffic: [{ latestRevision: true, weight: 100 }] } }, template: { containers: [{ ...container, env: [...env("cw_control"), { name: "CW_CONTROL_PORT", value: "8080" }, { name: "CW_CUSTOMER_FEATURES_ENABLED", value: "false" }], probes }], scale: { minReplicas: 1, maxReplicas: 1 } } } };
    const job = { location: c.location, identity, properties: { environmentId: environment, configuration: { triggerType: "Manual", replicaTimeout: 180, replicaRetryLimit: 0, manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }, registries }, template: { containers: [{ ...container, name: c.migrationJob, env: env("cw_migrator"), command: ["node"], args: ["dist/database/cli.js"] }] } } };
    return { api, job };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 3 && !(process.argv.length === 4 && process.argv[3] === "--mcp-reader"))
            throw new Error();
        const c = await configuration();
        const probes = JSON.parse(await readFile("deployment/azure/control-probes.json", "utf8"));
        const resources = process.argv[3] === "--mcp-reader" ? {bootstrap:bootstrapResource(c,process.argv[2],"mcp-reader")} : { ...computeResources(c, process.argv[2], probes), bootstrap: bootstrapResource(c, process.argv[2]) };
        await mkdir(".delivery", { recursive: true });
        for (const [name, value] of Object.entries(resources))
            await writeFile(`.delivery/${name}.json`, JSON.stringify(value, null, 2) + "\n");
        console.log(JSON.stringify({ resourceManifestsRendered: true, liveResourcesChanged: false }));
    }
    catch {
        console.error(JSON.stringify({ resourceManifestsRendered: false }));
        process.exitCode = 1;
    }
}
