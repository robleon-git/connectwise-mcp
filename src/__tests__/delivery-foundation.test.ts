import { readFile } from "node:fs/promises";
import { describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { createControlApi } from "../control-plane/server.js";
import { databasePool } from "../database/pool.js";
import { databaseConfig } from "../database/config.js";
import { migrate, loadMigrations } from "../database/migrationRunner.js";
import { MIGRATIONS } from "../database/migrationManifest.js";
// @ts-expect-error Local operator scripts use JavaScript.
import { smoke } from "../../scripts/deploy/smoke.mjs";
// @ts-expect-error Local operator scripts use JavaScript.
import { configuration, immutableImage, featureOnlyDeployment, needsDogfood } from "../../scripts/deploy/common.mjs";
// @ts-expect-error Local operator renderer uses JavaScript.
import { computeResources, bootstrapResource } from "../../scripts/deploy/render-resources.mjs";
async function api(check: () => Promise<boolean>) {
    const service = createControlApi(check);
    const server = createServer(service.app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string")
        throw new Error();
    return { ...service, url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }) };
}
describe("Phase 0 health-only control API", () => {
    it("liveness does not query database; unavailable readiness is safe", async () => {
        const canary = "PRIVATE_PASSWORD_JWT_PAYLOAD";
        const ready = vi.fn(async () => { throw new Error(canary); });
        const s = await api(ready);
        try {
            const health = await fetch(s.url + "/health");
            expect(health.status).toBe(200);
            expect(ready).not.toHaveBeenCalled();
            const r = await fetch(s.url + "/ready");
            expect(r.status).toBe(503);
            expect(await r.text()).toBe('{"status":"unavailable"}');
        }
        finally {
            await s.close();
        }
    });
    it("readiness succeeds and drain rejects probes", async () => {
        const s = await api(async () => true);
        try {
            expect((await fetch(s.url + "/ready")).status).toBe(200);
            s.drain();
            expect((await fetch(s.url + "/ready")).status).toBe(503);
            expect((await fetch(s.url + "/health")).status).toBe(503);
        }
        finally {
            await s.close();
        }
    });
    it("all product and MCP routes remain unavailable regardless of supplied data", async () => {
        const ready = vi.fn(async () => true);
        const s = await api(ready);
        try {
            for (const path of ["/api/signup", "/api/account", "/api/billing", "/api/connectwise", "/admin", "/mcp"]) {
                const r = await fetch(s.url + path, { method: "POST", headers: { Authorization: "Bearer synthetic-secret", "Content-Type": "application/json" }, body: '{"privateKey":"synthetic-key"}' });
                expect(r.status).toBe(404);
                expect(await r.text()).toBe('{"error":"not_available"}');
                expect(r.headers.get("x-powered-by")).toBeNull();
            }
            expect(ready).not.toHaveBeenCalled();
        }
        finally {
            await s.close();
        }
    });
});
const production = { NODE_ENV: "production", CW_DB_HOST: "monotorr-cw-db-01.postgres.database.azure.com", CW_DB_NAME: "connectwise", CW_DB_USER: "cw_control", CW_KEY_VAULT_URI: "https://cw-mcp-kv.vault.azure.net", CW_DB_PASSWORD_SECRET: "cw-control-db-password" };
describe("database config", () => {
    it("retrieves only the database secret and preserves verified TLS", async () => {
        const read = vi.fn(async () => "synthetic-db-password");
        const factory = vi.fn(async () => read);
        const pool = databasePool(production, factory);
        try {
            expect(pool.options.ssl).toEqual({ rejectUnauthorized: true });
            const password = pool.options.password;
            expect(typeof password).toBe("function");
            if (typeof password !== "function")
                throw new Error();
            expect(await password()).toBe("synthetic-db-password");
            expect(read).toHaveBeenCalledWith("cw-control-db-password");
            expect(read).toHaveBeenCalledTimes(1);
        }
        finally {
            await pool.end();
        }
    });
    it("redacts Vault failure objects from the DB password provider", async () => {
        const pool = databasePool(production, async () => async () => { throw new Error("synthetic-customer-secret"); });
        try {
            const password = pool.options.password;
            if (typeof password !== "function")
                throw new Error();
            await expect(password()).rejects.toThrow(/^database_credentials_unavailable$/);
        }
        finally {
            await pool.end();
        }
    });
    it("requires verified Azure TLS configuration and a scoped secret", () => { expect(databaseConfig(production)).toMatchObject({ local: false, passwordSecret: "cw-control-db-password" }); });
    it.each([{ CW_DB_HOST: "127.0.0.1" }, { CW_DB_PASSWORD_SECRET: "connectwise-private-key" }, { CW_DB_LOCAL_PASSWORD: "synthetic" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { CW_KEY_VAULT_URI: "https://evil.example" }, { CW_DB_NAME: "x;DROP DATABASE" }])("rejects unsafe production config %j", override => { expect(() => databaseConfig({ ...production, ...override })).toThrow("invalid_database_configuration"); });
    it("allows only explicit loopback test mode outside production", () => { const local = { NODE_ENV: "test", CW_DB_LOCAL_TEST: "true", CW_DB_HOST: "127.0.0.1", CW_DB_NAME: "cw_delivery_test", CW_DB_USER: "postgres", CW_DB_LOCAL_PASSWORD: "synthetic" }; expect(databaseConfig(local).local).toBe(true); expect(() => databaseConfig({ ...local, NODE_ENV: "production" })).toThrow(); });
});
describe("migration foundation", () => {
    it("loads immutable SQL from the manifest", async () => { const loaded = await loadMigrations(MIGRATIONS, new URL("../../database/migrations/", import.meta.url)); expect(loaded).toHaveLength(4); expect(loaded[1].id).toBe("0002_customer_foundation"); expect(loaded[0].sql).not.toMatch(/CREATE TABLE.*(?:users|accounts|entitlements)/i); });
    it("rejects checksum changes before connection", async () => { await expect(loadMigrations([{ ...MIGRATIONS[0], checksum: "bad" }], new URL("../../database/migrations/", import.meta.url))).rejects.toThrow("migration_checksum_mismatch"); });
    it("rolls back and releases lock/client without raw error leakage", async () => {
        const query = vi.fn(async (sql: string) => {
            if (sql.startsWith("CREATE TABLE"))
                throw new Error("synthetic-password SQL private error");
            return { rows: [], command: "SELECT", rowCount: 0, oid: 0, fields: [] };
        });
        const release = vi.fn();
        await expect(migrate({ connect: async () => ({ query, release }) } as never, [])).rejects.toThrow(/^migration_failed$/);
        expect(query.mock.calls.map(c => c[0])).toContain("ROLLBACK");
        expect(query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
        expect(release).toHaveBeenCalledOnce();
    });
});
describe("product-specific delivery safeguards", () => {
    it("renders only NEW resources with probes, separate identities and no plaintext secrets", async () => { const c = await configuration(); const r = computeResources(c, "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64), [{ type: "Readiness" }]); expect(r.api.properties.template.containers[0].probes).toEqual([{ type: "Readiness" }]); expect(r.api.properties.configuration.ingress.allowInsecure).toBe(false); expect(r.api.identity.type).toContain("SystemAssigned"); expect(r.job.properties.configuration.triggerType).toBe("Manual"); expect(JSON.stringify(r)).not.toContain("connectwise-mcp-pilot"); expect(JSON.stringify(r)).not.toContain("connectwise-private-key"); expect(r.job.properties.template.containers[0].env.find((e: {
        name: string;
    }) => e.name === "CW_DB_USER").value).toBe("cw_migrator"); });
    it("pins new resource targets and forbids MCP deployment", async () => { const c = await configuration(); expect(c.resourceGroup).toBe("monotorr-connectwise-prod-rg"); expect(() => featureOnlyDeployment("mcp")).toThrow(); expect(() => immutableImage(c, "monotorrdevacr6689.azurecr.io/monotorr-api@sha256:" + "a".repeat(64))).toThrow(); expect(immutableImage(c, "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64))).toContain("@sha256:"); });
    it.each(["src/auth/descope-mcp.ts", "src/accounts/service.ts", "src/entitlements/service.ts", "src/config-loader.ts", "src/api-client.ts", "src/tools/tickets.ts"])("requires owner QA for %s", path => { expect(needsDogfood([path])).toBe(true); });
    it("phase0 portal-only changes do not invent MCP QA", () => { expect(needsDogfood(["portal/src/main.tsx"])).toBe(false); });
    it("rejects bearer transport to arbitrary smoke URLs", async () => { await expect(smoke("https://evil.example", "mcp", vi.fn())).rejects.toThrow(); });
    it("outputs only safe smoke facts and ignores response bodies", async () => {
        const fetcher = vi.fn(async (input: URL) => input.pathname.includes("well-known") ? Response.json({ resource: "https://api.monotorr.com/mcp", authorization_servers: ["https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au"], scopes_supported: ["connectwise.read"] }) : new Response("synthetic-secret-response", { status: input.pathname === "/mcp" ? 401 : 200, headers: { "WWW-Authenticate": 'Bearer resource_metadata="https://api.monotorr.com/.well-known/oauth-protected-resource/mcp"' } }));
        const r = await smoke("https://api.monotorr.com", "mcp", fetcher);
        expect(r).toEqual({ smokePassed: true, component: "mcp" });
        expect(JSON.stringify(r)).not.toContain("synthetic-secret");
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});

 describe("approved Phase 0 PostgreSQL target", () => {
    it("renders API, migration and bootstrap with only the new database host while keeping compute in East US", async () => {
        const c = await configuration();
        expect(c.databaseServer).toBe("monotorr-cw-db-01");
        const image = "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64);
        const { api, job } = computeResources(c, image, []);
        const bootstrap = bootstrapResource(c, image);
        for (const resource of [api, job, bootstrap]) {
            expect(resource.location).toBe("eastus");
            expect(resource.properties.template.containers[0].env).toContainEqual({ name: "CW_DB_HOST", value: "monotorr-cw-db-01.postgres.database.azure.com" });
            expect(JSON.stringify(resource)).not.toContain("monotorr-cw-prod-pg");
        }
    });
});

describe("release evidence publication", () => {
    it("includes hidden delivery evidence with an explicit nonsecret file allowlist", async () => {
        const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
        const evidence = workflow.slice(workflow.indexOf("          name: phase0-release"));
        expect(evidence).toContain(".delivery/built-image.json");
        expect(evidence).toContain(".delivery/control-release.json");
        expect(evidence).toContain("include-hidden-files: true");
        expect(evidence).toContain("if-no-files-found: error");
        expect(evidence).not.toContain(".delivery/*.json");
    });
});


describe("Phase 0 portal authentication remains unavailable", () => {
    it.each(["aad", "github"])("explicitly blocks the built-in %s login route", async provider => {
        const config = JSON.parse(await readFile(new URL("../../portal/public/staticwebapp.config.json", import.meta.url), "utf8"));
        expect(config.routes).toContainEqual({ route: `/.auth/login/${provider}`, statusCode: 404 });
        expect(config.navigationFallback.exclude).toContain("/.auth/*");
    });
    it.each(["aad", "github"])("rejects a live %s login redirect instead of accepting incomplete authentication", async provider => {
        const fetcher = vi.fn(async (input: URL, options: RequestInit) => {
            expect(options.redirect).toBe("error");
            if (input.pathname === "/") return new Response('<div id="root"></div><script src="/assets/shell.js"></script>');
            if (input.pathname === `/.auth/login/${provider}`)
                return new Response(null, { status: 302, headers: { Location: "https://example.invalid/login" } });
            return new Response(null, { status: 404 });
        });
        await expect(smoke("https://black-bush-04c7a8b0f.5.azurestaticapps.net", "portal", fetcher)).rejects.toThrow("smoke_failed");
    });
});
