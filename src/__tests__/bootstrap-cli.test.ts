import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const f = vi.hoisted(() => ({ managed: vi.fn(), get: vi.fn(), set: vi.fn(), end: vi.fn(), query: vi.fn(), release: vi.fn(), connect: vi.fn() }));
const silent = () => ({ error: { log: vi.fn() }, warning: { log: vi.fn() }, info: { log: vi.fn() }, verbose: { log: vi.fn() } });
vi.mock("@azure/identity", () => ({ logger: silent(), ManagedIdentityCredential: class { constructor(options: unknown) { f.managed(options); } } }));
vi.mock("@azure/keyvault-secrets", () => ({ logger: silent(), SecretClient: class { getSecret = f.get; setSecret = f.set; } }));
vi.mock("pg", () => ({ Pool: class { connect = f.connect; end = f.end; on = vi.fn(); } }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  for (const [name, value] of Object.entries({ NODE_ENV: "production", CW_BOOTSTRAP_CONFIRM: "INITIALIZE_CONNECTWISE_DATABASE", CW_DB_HOST: "monotorr-cw-db-01.postgres.database.azure.com", CW_DB_NAME: "connectwise", CW_DB_USER: "cw_bootstrap_admin", CW_KEY_VAULT_URI: "https://cw-mcp-kv.vault.azure.net" })) vi.stubEnv(name, value);
  f.get.mockImplementation(async (name: string) => ({ value: name === "cw-bootstrap-db-password" ? "SYNTHETIC_PRIVATE_DB_PASSWORD" : "__CW_DATABASE_BOOTSTRAP_PENDING__" }));
  f.set.mockResolvedValue({}); f.end.mockResolvedValue(undefined);
  f.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("current_database") ? [{ database: "connectwise", username: "cw_bootstrap_admin" }] : sql.includes("pg_try_advisory_lock") ? [{ locked: true }] : [] }));
  f.connect.mockResolvedValue({ query: f.query, release: f.release });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); process.exitCode = undefined; });
describe("packaged bootstrap CLI", () => {
  it("uses only managed identity and named secrets, with sanitized success output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}); const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await import("../database/bootstrap-cli.js");
    expect(f.managed).toHaveBeenCalledOnce(); expect(f.get.mock.calls.map(c => c[0])).toEqual(["cw-bootstrap-db-password", "cw-control-db-password", "cw-migration-db-password"]);
    expect(log).toHaveBeenCalledExactlyOnceWith('{"databaseBootstrapSucceeded":true}'); expect(error).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("SYNTHETIC_PRIVATE_DB_PASSWORD");
    for (const call of f.set.mock.calls) expect(JSON.stringify(log.mock.calls)).not.toContain(call[1]);
    expect(f.end).toHaveBeenCalledOnce();
  });
  it("Vault errors never print secret material or raw errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    f.set.mockRejectedValue(new Error("SYNTHETIC_PRIVATE_DB_PASSWORD Authorization: Bearer synthetic-token"));
    await import("../database/bootstrap-cli.js");
    expect(error).toHaveBeenCalledExactlyOnceWith('{"databaseBootstrapSucceeded":false,"details":"redacted"}'); expect(process.exitCode).toBe(1); expect(f.end).toHaveBeenCalledOnce();
  });
  it("cannot run implicitly or under development fallback credentials", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {}); vi.stubEnv("NODE_ENV", "development");
    await import("../database/bootstrap-cli.js");
    expect(f.managed).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledExactlyOnceWith('{"databaseBootstrapSucceeded":false,"details":"redacted"}');
  });
});
