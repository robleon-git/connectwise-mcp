import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
export interface Migration {
    id: string;
    file: string;
    checksum: string;
}
export type MigrationClient = Pick<PoolClient, "query" | "release">;
export async function loadMigrations(manifest: readonly Migration[], directory: URL): Promise<(Migration & {
    sql: string;
})[]> {
    const result = [];
    const ids = new Set<string>();
    for (const item of manifest) {
        if (!/^[0-9]{4}_[a-z_]+$/.test(item.id) || item.file !== item.id + ".sql" || ids.has(item.id))
            throw new Error("invalid_migration_manifest");
        ids.add(item.id);
        const sql = await readFile(new URL(item.file, directory), "utf8");
        if (createHash("sha256").update(sql).digest("hex") !== item.checksum)
            throw new Error("migration_checksum_mismatch");
        result.push({ ...item, sql });
    }
    return result;
}
export async function migrate(pool: Pick<Pool, "connect">, migrations: readonly (Migration & {
    sql: string;
})[]): Promise<{
    applied: number;
}> {
    const client: MigrationClient = await pool.connect();
    let locked = false;
    let transaction = false;
    let applied = 0;
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
        const known = new Map(migrations.map(m => [m.id, m]));
        for (const row of existing.rows)
            if (known.get(row.id)?.checksum !== row.checksum)
                throw new Error("migration_history_mismatch");
        for (const migration of migrations) {
            if (existing.rows.some(row => row.id === migration.id))
                continue;
            await client.query(migration.sql);
            await client.query("INSERT INTO public.schema_migrations(id,checksum) VALUES($1,$2)", [migration.id, migration.checksum]);
            applied++;
        }
        await client.query("COMMIT");
        transaction = false;
        return { applied };
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
