import { bootstrapMcpReader } from "../database/mcp-bootstrap.js";
import { describe, it, expect, vi } from "vitest";
import { bootstrapDatabase, bootstrapSettings, BOOTSTRAP_PENDING } from "../database/bootstrap.js";
// @ts-expect-error Operator script is JavaScript.
import { operateBootstrap } from "../../scripts/deploy/bootstrap-database.mjs";
// @ts-expect-error Resource renderer is JavaScript.
import { bootstrapResource } from "../../scripts/deploy/render-resources.mjs";
// @ts-expect-error Operator configuration is JavaScript.
import { configuration } from "../../scripts/deploy/common.mjs";
function fixture() {
  const query = vi.fn(async (sql: string) => ({ rows: sql.includes("current_database") ? [{ database: "connectwise", username: "cw_bootstrap_admin" }] : sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [] }));
  const release = vi.fn(); const connect = vi.fn(async () => ({ query, release }));
  const store = { get: vi.fn(async () => BOOTSTRAP_PENDING as string | undefined), set: vi.fn(async (_name: string, _value: string) => {}) };
  let n = 0; const generate = () => (++n === 1 ? "a" : "b").repeat(64);
  return { query, release, connect, store, generate };
}
describe("bounded database bootstrap", () => {
  it("initializes only the two DB roles/secrets with explicit non-admin privileges and no output secrets", async () => {
    const f = fixture(); const result = await bootstrapDatabase({ connect: f.connect } as never, f.store, f.generate);
    expect(result).toEqual({ databaseBootstrapSucceeded: true });
    expect(f.store.set.mock.calls.map(c => c[0])).toEqual(["cw-control-db-password", "cw-migration-db-password"]);
    const sql = f.query.mock.calls.map(c => c[0]).join(" ");
    expect(sql).toContain("NOCREATEROLE"); expect(sql).toContain("NOBYPASSRLS");
    expect(sql).toContain("REVOKE cw_migrator FROM cw_bootstrap_admin");
    expect(JSON.stringify(result)).not.toContain("a".repeat(64)); expect(f.release).toHaveBeenCalledOnce();
  });
  it.each(["existing", "absent", "busy", "wrong_database"])("refuses %s without writes", async reason => {
    const f = fixture();
    if (reason === "existing") f.store.get.mockResolvedValue("synthetic-existing-password");
    if (reason === "absent") f.store.get.mockResolvedValue(undefined);
    if (reason === "busy") f.query.mockImplementation(async sql => ({ rows: sql.includes("current_database") ? [{ database: "connectwise", username: "cw_bootstrap_admin" }] : [] }) as never);
    if (reason === "wrong_database") f.query.mockResolvedValue({ rows: [{ database: "monotorr", username: "cw_bootstrap_admin" }] } as never);
    await expect(bootstrapDatabase({ connect: f.connect } as never, f.store, f.generate)).rejects.toThrow(/^database_bootstrap_failed$/);
    expect(f.store.set).not.toHaveBeenCalled();
  });
  it("rolls SQL back and sanitizes database/Vault errors; does not rotate on partial failures", async () => {
    const f = fixture(); const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async sql => { if (sql.startsWith("CREATE ROLE")) throw new Error("PRIVATE_DB_PASSWORD"); return original(sql); });
    await expect(bootstrapDatabase({ connect: f.connect } as never, f.store, f.generate)).rejects.toThrow(/^database_bootstrap_failed$/);
    expect(f.query.mock.calls.map(c => c[0])).toContain("ROLLBACK"); expect(f.release).toHaveBeenCalledOnce();
    const g = fixture(); g.store.set.mockRejectedValue(new Error("PRIVATE_VAULT_ERROR"));
    await expect(bootstrapDatabase({ connect: g.connect } as never, g.store, g.generate)).rejects.toThrow(/^database_bootstrap_failed$/);
    expect(g.query.mock.calls.map(c => c[0])).not.toContain("BEGIN");
  });
  it("rejects unsafe configuration and requires an explicit production operation", () => {
    const env = { NODE_ENV: "production", CW_BOOTSTRAP_CONFIRM: "INITIALIZE_CONNECTWISE_DATABASE", CW_DB_HOST: "monotorr-cw-db-01.postgres.database.azure.com", CW_DB_NAME: "connectwise", CW_DB_USER: "cw_bootstrap_admin", CW_KEY_VAULT_URI: "https://cw-mcp-kv.vault.azure.net" };
    expect(bootstrapSettings(env).user).toBe("cw_bootstrap_admin");
    for (const override of [{ CW_BOOTSTRAP_CONFIRM: "" }, { NODE_ENV: "development" }, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { CW_DB_HOST: "monotorr-dev-db.postgres.database.azure.com" }, { CW_DB_USER: "cw_control" }]) expect(() => bootstrapSettings({ ...env, ...override })).toThrow();
  });
  it("packages a separate manual identity/job with no retries, no ingress, and 180-second limit", async () => {
    const job = bootstrapResource(await configuration(), "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64));
    expect(job.properties.template.containers[0].args).toEqual(["dist/database/bootstrap-cli.js"]);
    expect(job.properties.configuration.replicaRetryLimit).toBe(0); expect(job.properties.configuration.replicaTimeout).toBe(180);
    expect(job.identity.type).toContain("SystemAssigned"); expect(job.properties.configuration.ingress).toBeUndefined();
    expect(JSON.stringify(job)).not.toContain("cw-control-db-password");
  });
});
function operatorFixture(status = "Succeeded", cleanupFails = false) {
  const principal = "a".repeat(8) + "-" + "a".repeat(4) + "-" + "a".repeat(4) + "-" + "a".repeat(4) + "-" + "a".repeat(12);
  const c = { subscriptionId: "s", sharedResourceGroup: "shared", resourceGroup: "new", vault: "cw-mcp-kv", registry: "monotorrdevacr6689" };
  const base = "/subscriptions/s/resourceGroups/shared/providers/Microsoft.KeyVault/vaults/cw-mcp-kv/secrets/";
  const roles = ["cw-bootstrap-db-password", "cw-control-db-password", "cw-migration-db-password"].map((name, i) => ({ scope: base + name, role: i === 0 ? "4633458b-17de-408a-b874-0445c86b69e6" : "b86a8fe4-44ce-4948-aee5-eccb2c155cd7", id: base + name + "/providers/Microsoft.Authorization/roleAssignments/" + i }));
  const az = vi.fn(async (args: string[]) => {
    if (args.includes("assignment") && args.includes("list")) return JSON.stringify(roles);
    if (args.includes("assignment") && args.includes("delete")) { if (cleanupFails) throw new Error("PRIVATE_ERROR"); roles.splice(roles.findIndex(r => r.id === args[args.indexOf("--ids") + 1]), 1); return ""; }
    if (args.includes("execution")) return status;
    if (args.includes("start")) return "connectwise-bootstrap-1";
    if (args.includes("show")) return JSON.stringify({ principal, image: "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64), args: ["dist/database/bootstrap-cli.js"], command: ["node"], containerCount: 1, parallelism: 1, completionCount: 1, trigger: "Manual", retries: 0, timeout: 180 });
    return "";
  });
  return { az, configuration: async () => c, assertSubscription: vi.fn(), wait: vi.fn(), roles };
}
describe("operator-only bootstrap cleanup", () => {
  it("success removes all elevated assignments, disables bootstrap password, deletes job", async () => {
    const f = operatorFixture(); expect(await operateBootstrap("run", f)).toEqual({ databaseBootstrapSucceeded: true, bootstrapPermissionsRemoved: true, bootstrapJobDeleted: true });
    expect(f.roles).toEqual([]); expect(f.az.mock.calls.some(c => c[0].includes("set-attributes"))).toBe(true);
    expect(f.az.mock.calls.some(c => c[0].includes("job") && c[0].includes("delete"))).toBe(true);
    expect(f.az.mock.calls.every(c => !c[0].includes("secret") || !c[0].includes("show"))).toBe(true);
  });
  it.each(["Failed", "Running"])("failure/timeout %s still removes privileges", async status => {
    const f = operatorFixture(status); await expect(operateBootstrap("run", f)).rejects.toThrow("database_bootstrap_failed_permissions_removed"); expect(f.roles).toEqual([]);
  });
  it("cleanup failure blocks completion even after successful SQL", async () => {
    const f = operatorFixture("Succeeded", true); await expect(operateBootstrap("run", f)).rejects.toThrow(/^bootstrap_cleanup_required$/);
  });
  it("vault-wide or unexpected permissions prevent execution and cannot be reported as clean", async () => {
    const f = operatorFixture(); f.roles[0].scope = f.roles[0].scope.replace("/secrets/cw-bootstrap-db-password", "");
    await expect(operateBootstrap("run", f)).rejects.toThrow("bootstrap_cleanup_required");
    expect(f.az.mock.calls.some(c => c[0].includes("start"))).toBe(false);
    expect(f.az.mock.calls.some(c => c[0].includes("job") && c[0].includes("delete"))).toBe(true);
  });
  it("cleanup-only cannot start a new execution; implicit invocation is rejected", async () => {
    const f = operatorFixture(); await operateBootstrap("cleanup", f); expect(f.az.mock.calls.some(c => c[0].includes("start"))).toBe(false);
    await expect(operateBootstrap(undefined, f)).rejects.toThrow("explicit_bootstrap_action_required");
  });
});

describe("one-shot MCP reader bootstrap",()=>{
  it("creates only a constrained cw_mcp login/password and leaves relation grants to migration",async()=>{
    const f=fixture();expect(await bootstrapMcpReader({connect:f.connect} as never,f.store,f.generate)).toEqual({mcpReaderBootstrapSucceeded:true});
    expect(f.store.set.mock.calls.map(c=>c[0])).toEqual(["cw-mcp-db-password"]);
    expect(f.query.mock.calls.map(c=>c[0]).join(" ")).toContain("CREATE ROLE cw_mcp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
    expect(f.query.mock.calls.map(c=>c[0]).join(" ")).not.toContain("GRANT SELECT");
  });
  it("refuses non-placeholder or existing role without rotation and sanitizes errors",async()=>{
    const f=fixture();f.store.get.mockResolvedValue("synthetic-existing-password");await expect(bootstrapMcpReader({connect:f.connect} as never,f.store)).rejects.toThrow(/^mcp_reader_bootstrap_failed$/);expect(f.store.set).not.toHaveBeenCalled();
    const g=fixture();g.store.set.mockRejectedValue(new Error("private-key-canary"));await expect(bootstrapMcpReader({connect:g.connect} as never,g.store)).rejects.toThrow(/^mcp_reader_bootstrap_failed$/);
  });
  it("renders the same bounded private manual job with a distinct exact purpose",async()=>{
    const job=bootstrapResource(await configuration(),"monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:"+"a".repeat(64),"mcp-reader");
    expect(job.properties.template.containers[0].env).toContainEqual({name:"CW_BOOTSTRAP_CONFIRM",value:"INITIALIZE_CONNECTWISE_MCP_READER"});
    expect(job.properties.configuration.replicaRetryLimit).toBe(0);expect(job.properties.configuration.replicaTimeout).toBe(180);
  });
  it("operator cleanup removes only the two temporary secret-scoped assignments",async()=>{
    const f=operatorFixture();f.roles.splice(1,2,{...f.roles[1],scope:f.roles[1].scope.replace("cw-control-db-password","cw-mcp-db-password"),id:f.roles[1].id.replace("cw-control-db-password","cw-mcp-db-password")});
    const original=f.az.getMockImplementation()!;f.az.mockImplementation(async(args:string[])=>{
      const result=await original(args);if(args.includes("show")&&!args.includes("execution"))return JSON.stringify({...JSON.parse(result),confirm:["INITIALIZE_CONNECTWISE_MCP_READER"]});return result;
    });
    expect(await operateBootstrap("run-mcp",f)).toMatchObject({databaseBootstrapSucceeded:true,bootstrapPermissionsRemoved:true,bootstrapJobDeleted:true});
    expect(f.roles).toHaveLength(0);
  });
});
