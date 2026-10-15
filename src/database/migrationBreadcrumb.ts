import { createHash } from "node:crypto";
export const BREADCRUMB_VERSION = "migration-breadcrumb-v1";
export interface MigrationContext {
    repository: string; run: string; attempt: string; sha: string; image: string;
    request: string; selection: string; manifestFingerprint: string; requestedAt: string;
}
export function validateMigrationContext(value: unknown): MigrationContext {
    const c = value as MigrationContext;
    if (!c || Object.values(c).some(value => typeof value !== "string") || Object.keys(c).sort().join() !== ["repository","run","attempt","sha","image","request","selection","manifestFingerprint","requestedAt"].sort().join() ||
        c.repository !== "robleon-git/connectwise-mcp" || !/^[1-9][0-9]*$/.test(c.run) || !/^[1-9][0-9]*$/.test(c.attempt) ||
        !/^[a-f0-9]{40}$/.test(c.sha) || !/^monotorrdevacr6689\.azurecr\.io\/connectwise-control-api@sha256:[a-f0-9]{64}$/.test(c.image) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(c.request) || !["core","core,billing"].includes(c.selection) || !/^[a-f0-9]{64}$/.test(c.manifestFingerprint) ||
        typeof c.requestedAt !== "string" || !Number.isFinite(Date.parse(c.requestedAt)) || new Date(c.requestedAt).toISOString() !== c.requestedAt) throw new Error("migration_context_invalid");
    return c;
}
export function packageFingerprint(migrations: unknown): string {
    return createHash("sha256").update(JSON.stringify(migrations)).digest("hex");
}
export function migrationContext(env: NodeJS.ProcessEnv, selection: string): MigrationContext | undefined {
    if (!env.CW_MIGRATION_CONTEXT) {
        if (env.NODE_ENV === "production") throw new Error("migration_context_required");
        return;
    }
    const c = validateMigrationContext(JSON.parse(Buffer.from(env.CW_MIGRATION_CONTEXT, "base64url").toString("utf8")));
    if (c.selection !== selection || !/^[a-z0-9-]+$/.test(env.CONTAINER_APP_JOB_EXECUTION_NAME || "") ||
        Date.now() - Date.parse(c.requestedAt) > 30 * 60_000 || Date.parse(c.requestedAt) > Date.now() + 60_000) throw new Error("migration_context_mismatch");
    return c;
}
export function breadcrumb(context: MigrationContext, execution: string, phase: "start" | "success" | "failure", result?: unknown) {
    return { version: BREADCRUMB_VERSION, event: `migration.${phase}`, context, execution,
        timestamp: new Date().toISOString(), ...(phase === "success" ? { schemaVerified: true, transactionCommitted: true, result } :
            phase === "failure" ? { schemaVerified: false, transactionCommitted: false, outcome: "unproven", result: {appliedIds:null,deferredIds:null,installedOptionalIds:null} } : {}) };
}
/** Detailed receipts are persisted only to the isolated receipt container. */
export { publishReceipt as emitBreadcrumb } from "./migrationReceiptStore.js";
