import { describe, it, expect } from "vitest";
import { Pool } from "pg";
import { migrate, loadMigrations } from "../database/migrationRunner.js";
import { bootstrapDatabase, BOOTSTRAP_PENDING } from "../database/bootstrap.js";
import { verifyCustomerDatabase } from "./fixtures/customer-database.js";
import { verifyConnectionDatabase } from "./fixtures/connection-database.js";
import { bootstrapMcpReader } from "../database/mcp-bootstrap.js";
import { verifyMcpDatabase } from "./fixtures/mcp-database.js";
import { MCP_DATABASE_LIMITS } from "../database/pool.js";
import { MIGRATIONS } from "../database/migrationManifest.js";
describe.skipIf(process.env.CW_DATABASE_INTEGRATION !== "true")("real disposable PostgreSQL 18 migrations", () => {
    it("bootstraps a private-job-shaped non-superuser admin, migrates, and rejects runtime administration", async () => {
        if (process.env.CW_DB_HOST !== "127.0.0.1" || process.env.CW_DB_NAME !== "cw_delivery_test") throw new Error("disposable_database_required");
        const local = { host: "127.0.0.1", port: Number(process.env.CW_DB_PORT || "5432"), ssl: false as const };
        const owner = new Pool({ ...local, database: "cw_delivery_test", user: "postgres", password: process.env.CW_DB_LOCAL_PASSWORD });
        let admin: Pool | undefined, runtime: Pool | undefined, migrator: Pool | undefined, mcp: Pool | undefined;
        try {
            expect((await owner.query("SHOW server_version")).rows[0].server_version).toMatch(/^18\./);
            await owner.query("CREATE ROLE cw_bootstrap_admin LOGIN CREATEROLE NOSUPERUSER PASSWORD 'synthetic-local-bootstrap-only'");
            await owner.query("CREATE DATABASE connectwise OWNER cw_bootstrap_admin");
            admin = new Pool({ ...local, database: "connectwise", user: "cw_bootstrap_admin", password: "synthetic-local-bootstrap-only" });
            const secrets = new Map<string, string>([["cw-control-db-password", BOOTSTRAP_PENDING], ["cw-migration-db-password", BOOTSTRAP_PENDING]]);
            const store = { get: async (name: string) => secrets.get(name), set: async (name: string, value: string) => { secrets.set(name, value); } };
            expect(await bootstrapDatabase(admin, store)).toEqual({ databaseBootstrapSucceeded: true });
            await expect(bootstrapDatabase(admin, store)).rejects.toThrow(/^database_bootstrap_failed$/);
            const privileges = (await admin.query("SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname IN ('cw_control','cw_migrator')")).rows;
            for (const role of privileges) expect(role).toMatchObject({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false });
            expect((await admin.query("SELECT pg_has_role('cw_bootstrap_admin','cw_migrator','SET') AS member")).rows[0].member).toBe(false);
            secrets.set("cw-mcp-db-password",BOOTSTRAP_PENDING);
            expect(await bootstrapMcpReader(admin,store)).toEqual({mcpReaderBootstrapSucceeded:true});
            await expect(bootstrapMcpReader(admin,store)).rejects.toThrow("mcp_reader_bootstrap_failed");
            migrator = new Pool({ ...local, database: "connectwise", user: "cw_migrator", password: secrets.get("cw-migration-db-password") });
            const migrations = await loadMigrations(MIGRATIONS, new URL("../../database/migrations/", import.meta.url));
            expect((await migrate(migrator, migrations)).applied).toBe(4);
            runtime = new Pool({ ...local, database: "connectwise", user: "cw_control", password: secrets.get("cw-control-db-password") });
            expect((await runtime.query("SELECT id FROM public.schema_migrations")).rows).toHaveLength(4);
            await verifyCustomerDatabase(runtime, migrator);
            await verifyConnectionDatabase(runtime, migrator);
            mcp = new Pool({...local,...MCP_DATABASE_LIMITS,database:"connectwise",user:"cw_mcp",password:secrets.get("cw-mcp-db-password")});
            expect((await mcp.query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("5s");
            expect((await mcp.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("2s");
            await expect(mcp.query("SELECT pg_sleep(6)")).rejects.toMatchObject({code:"57014"});
            expect((await runtime.query("SHOW statement_timeout")).rows[0].statement_timeout).toBe("0");
            const locker=await migrator.connect();
            try {
                await locker.query("BEGIN; LOCK TABLE public.schema_migrations IN ACCESS EXCLUSIVE MODE");
                await expect(mcp.query("SELECT id FROM public.schema_migrations")).rejects.toMatchObject({code:"55P03"});
            } finally {await locker.query("ROLLBACK");locker.release();}
            await verifyMcpDatabase(runtime,mcp,migrator);
            expect((await mcp.query("SELECT id FROM public.schema_migrations")).rows).toHaveLength(4);
            await expect(runtime.query("DELETE FROM public.schema_migrations")).rejects.toThrow();
            await expect(runtime.query("CREATE TABLE public.forbidden(id int)")).rejects.toThrow();
            await expect(runtime.query("SET ROLE cw_migrator")).rejects.toThrow();
            await expect(migrator.query("CREATE ROLE forbidden_role")).rejects.toThrow();
        } finally {
            await Promise.all([admin?.end(), runtime?.end(), migrator?.end(), mcp?.end()]);
            // pool.end() can finish before PostgreSQL has observed every socket close.
            // Wait for backend disconnects; FORCE can emit a late uncaught pool error in CI.
            let remaining = 1;
            for (let attempt = 0; attempt < 100; attempt++) {
                remaining = Number((await owner.query("SELECT count(*) AS count FROM pg_stat_activity WHERE datname = 'connectwise'")).rows[0].count);
                if (remaining === 0) break;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            expect(remaining).toBe(0);
            await owner.query("DROP DATABASE IF EXISTS connectwise");
            await owner.query("DROP ROLE IF EXISTS cw_control,cw_migrator,cw_mcp,cw_bootstrap_admin");
            await owner.end();
        }
    }, 30000);
    it("applies once, serializes concurrent runners, rejects history edits, and constrains runtime role", async () => {
        if (process.env.CW_DB_HOST !== "127.0.0.1" || process.env.CW_DB_NAME !== "cw_delivery_test")
            throw new Error("disposable_database_required");
        const pool = new Pool({ host: "127.0.0.1", port: Number(process.env.CW_DB_PORT || "5432"), user: process.env.CW_DB_USER || "postgres", password: process.env.CW_DB_LOCAL_PASSWORD, database: "cw_delivery_test", ssl: false });
        try {
            expect((await pool.query("SHOW server_version")).rows[0].server_version).toMatch(/^18\./);
            await pool.query("DROP TABLE IF EXISTS public.schema_migrations");
            const migrations = await loadMigrations(MIGRATIONS.slice(0,1), new URL("../../database/migrations/", import.meta.url));
            const results = await Promise.all([migrate(pool, migrations), migrate(pool, migrations)]);
            expect(results.reduce((n, r) => n + r.applied, 0)).toBe(1);
            expect((await migrate(pool, migrations)).applied).toBe(0);
            await pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cw_control_test') THEN CREATE ROLE cw_control_test; END IF; END $$");
            await pool.query("GRANT USAGE ON SCHEMA public TO cw_control_test; GRANT SELECT ON public.schema_migrations TO cw_control_test");
            const client = await pool.connect();
            try {
                await client.query("SET ROLE cw_control_test");
                await client.query("SELECT * FROM public.schema_migrations");
                await expect(client.query("DELETE FROM public.schema_migrations")).rejects.toThrow();
            }
            finally {
                await client.query("RESET ROLE");
                client.release();
            }
            await pool.query("UPDATE public.schema_migrations SET checksum=$1", ["a".repeat(64)]);
            await expect(migrate(pool, migrations)).rejects.toThrow("migration_failed");
        }
        finally {
            await pool.query("DROP TABLE IF EXISTS public.schema_migrations").catch(() => { });
            await pool.query("DROP ROLE IF EXISTS cw_control_test").catch(() => { });
            await pool.end();
        }
    }, 30000);
});
