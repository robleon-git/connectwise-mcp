// Explicit operator command only. Not called by GitHub or the control API.
import { pathToFileURL } from "node:url";
import { configuration, assertSubscription, immutableImage, az } from "./common.mjs";
const userRole = "4633458b-17de-408a-b874-0445c86b69e6";
const officerRole = "b86a8fe4-44ce-4948-aee5-eccb2c155cd7";
export async function operateBootstrap(action, dependencies = {}) {
    if (!["run", "cleanup"].includes(action)) throw new Error("explicit_bootstrap_action_required");
    const call = dependencies.az || az;
    const c = await (dependencies.configuration || configuration)();
    await (dependencies.assertSubscription || assertSubscription)(c);
    const target = ["-n", "connectwise-bootstrap", "-g", c.resourceGroup];
    const kv = `/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}/providers/Microsoft.KeyVault/vaults/${c.vault}`;
    const job = JSON.parse(await call(["containerapp", "job", "show", ...target, "--query", "{principal:identity.principalId,image:properties.template.containers[0].image,args:properties.template.containers[0].args,command:properties.template.containers[0].command,containerCount:length(properties.template.containers),parallelism:properties.configuration.manualTriggerConfig.parallelism,completionCount:properties.configuration.manualTriggerConfig.replicaCompletionCount,trigger:properties.configuration.triggerType,retries:properties.configuration.replicaRetryLimit,timeout:properties.configuration.replicaTimeout}", "-o", "json"]));
    if (!/^[a-f0-9-]{36}$/.test(job.principal || "")) throw new Error("bootstrap_identity_unavailable");
    const scopes = new Map([
        [`${kv}/secrets/cw-bootstrap-db-password`.toLowerCase(), userRole],
        [`${kv}/secrets/cw-control-db-password`.toLowerCase(), officerRole],
        [`${kv}/secrets/cw-migration-db-password`.toLowerCase(), officerRole],
    ]);
    const assignments = async () => JSON.parse(await call(["role", "assignment", "list", "--all", "--fill-principal-name", "false", "--query", `[?principalId=='${job.principal}'].{id:id,scope:scope,role:roleDefinitionId}`, "-o", "json"]));
    let succeeded = false, cleaned = true;
    try {
        if (action === "run") {
            immutableImage(c, job.image);
            if (job.containerCount !== 1 || job.parallelism !== 1 || job.completionCount !== 1 || job.command?.length !== 1 || job.command[0] !== "node" || job.args?.length !== 1 || job.args[0] !== "dist/database/bootstrap-cli.js" || job.trigger !== "Manual" || job.retries !== 0 || job.timeout !== 180)
                throw new Error();
            const roles = await assignments();
            if (roles.length !== 3 || new Set(roles.map(r => r.scope.toLowerCase())).size !== 3 || roles.some(r => scopes.get(r.scope.toLowerCase()) !== r.role.split("/").at(-1))) throw new Error();
            const execution = await call(["containerapp", "job", "start", ...target, "--query", "name", "-o", "tsv"]);
            if (!/^[a-z0-9-]+$/.test(execution)) throw new Error();
            for (let i = 0; i < 24; i++) {
                const status = await call(["containerapp", "job", "execution", "show", ...target, "--job-execution-name", execution, "--query", "properties.status", "-o", "tsv"]);
                if (status === "Succeeded") { succeeded = true; break; }
                if (["Failed", "Stopped"].includes(status)) break;
                await (dependencies.wait || (() => new Promise(resolve => setTimeout(resolve, 10000))))();
            }
        }
    } catch { succeeded = false; }
    finally {
        // Cleanup is attempted on success, failure, or timeout; no admin service remains.
        // Delete only this job principal's reviewed secret-scoped assignments.
        try {
            for (const role of await assignments()) {
                if (scopes.get(role.scope.toLowerCase()) !== role.role.split("/").at(-1) ||
                    !role.id.toLowerCase().startsWith(role.scope.toLowerCase() + "/providers/microsoft.authorization/roleassignments/")) {
                    cleaned = false; continue;
                }
                try { await call(["role", "assignment", "delete", "--ids", role.id, "-o", "none"]); } catch { cleaned = false; }
            }
        } catch { cleaned = false; }
        try { await call(["keyvault", "secret", "set-attributes", "--vault-name", c.vault, "--name", "cw-bootstrap-db-password", "--enabled", "false", "-o", "none"]); } catch { cleaned = false; }
        try { await call(["containerapp", "job", "delete", ...target, "--yes", "-o", "none"]); } catch { cleaned = false; }
        try { if ((await assignments()).length) cleaned = false; } catch { cleaned = false; }
    }
    if (!cleaned) throw new Error("bootstrap_cleanup_required");
    if (action === "run" && !succeeded) throw new Error("database_bootstrap_failed_permissions_removed");
    return { databaseBootstrapSucceeded: succeeded, bootstrapPermissionsRemoved: true, bootstrapJobDeleted: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 3) throw new Error("explicit_bootstrap_action_required");
        console.log(JSON.stringify(await operateBootstrap(process.argv[2])));
    } catch (error) {
        const reason = ["bootstrap_cleanup_required", "database_bootstrap_failed_permissions_removed", "explicit_bootstrap_action_required"].includes(error?.message) ? error.message : "bootstrap_operation_failed";
        console.error(JSON.stringify({ databaseBootstrapSucceeded: false, reason }));
        process.exitCode = 1;
    }
}
