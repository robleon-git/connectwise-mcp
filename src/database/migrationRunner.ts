import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { validateMigrationManifest, validateMigrationHistory, requiredMigrations, type Migration } from "./migrationManifest.js";
export type { Migration } from "./migrationManifest.js";
export type MigrationClient = Pick<PoolClient, "query" | "release">;
export async function loadMigrations(manifest: readonly Migration[], directory: URL): Promise<(Migration & {
    sql: string;
})[]> {
    validateMigrationManifest(manifest);
    const result = [];
    for (const item of manifest) {
        const sql = await readFile(new URL(item.file, directory), "utf8");
        if (createHash("sha256").update(sql).digest("hex") !== item.checksum)
            throw new Error("migration_checksum_mismatch");
        result.push({ ...item, sql });
    }
    return result;
}
/** Explicit execution selection; omitted/unknown input never defaults to a schema scope. */
export function migrationFeatures(selection: unknown): readonly "billing"[] {
    if (selection === "core") return [];
    if (selection === "core,billing") return ["billing"];
    throw new Error("invalid_migration_features");
}
export async function migrate(pool: Pick<Pool, "connect">, migrations: readonly (Migration & {
    sql: string;
})[], features: readonly "billing"[]): Promise<{
    applied: number;
    requirements: readonly string[];
    appliedIds: string[];
    deferredIds: string[];
    installedOptionalIds: string[];
}> {
    // Always validate the complete supplied package, including disabled-feature SQL.
    let required: readonly Migration[];
    try {
        validateMigrationManifest(migrations);
        if (!Array.isArray(features)) throw new Error("invalid_migration_features");
        required = requiredMigrations(features, migrations);
        if (migrations.some(item => typeof item.sql !== "string" || createHash("sha256").update(item.sql).digest("hex") !== item.checksum)) throw new Error();
    } catch { throw new Error("migration_failed"); }
    const client: MigrationClient = await pool.connect();
    let locked = false;
    let transaction = false;
    const appliedIds: string[] = [];
    try {
        await client.query("SET lock_timeout = '10s'");
        await client.query("SET statement_timeout = '60s'");
        await client.query("SELECT pg_advisory_lock(hashtext('connectwise_schema_migrations_v1'))");
        locked = true;
        await client.query("BEGIN");
        transaction = true;
        await client.query("CREATE TABLE IF NOT EXISTS public.schema_migrations (id text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
        const existing = await client.query<{
            id: string;
            checksum: string;
        }>("SELECT id, checksum FROM public.schema_migrations");
        const installed = validateMigrationHistory(existing.rows, migrations);
        for (const migration of migrations.filter(item => required.some(entry => entry.id === item.id))) {
            if (installed.has(migration.id))
                continue;
            await client.query(migration.sql);
            await client.query("INSERT INTO public.schema_migrations(id,checksum) VALUES($1,$2)", [migration.id, migration.checksum]);
            appliedIds.push(migration.id);
        }
        const final = await client.query("SELECT id, checksum FROM public.schema_migrations");
        const complete = validateMigrationHistory(final.rows, migrations);
        if (!required.every(item => complete.has(item.id))) throw new Error("required_schema_incomplete");
        const deferredIds = migrations.filter(item => !required.some(entry => entry.id === item.id) && !complete.has(item.id)).map(item => item.id);
        const installedOptionalIds = migrations.filter(item => item.requirement !== "core" && complete.has(item.id)).map(item => item.id);
        await client.query("COMMIT");
        transaction = false;
        return { applied: appliedIds.length, requirements: ["core", ...features], appliedIds, deferredIds, installedOptionalIds };
    }
    catch {
        if (transaction)
            await client.query("ROLLBACK").catch(() => { });
        throw new Error("migration_failed");
    }
    finally {
        if (locked)
            await client.query("SELECT pg_advisory_unlock(hashtext('connectwise_schema_migrations_v1'))").catch(() => { });
        client.release();
    }
}
