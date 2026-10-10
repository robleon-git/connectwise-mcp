import { describe, it, expect, vi } from "vitest";
// @ts-expect-error Operator script has no declarations.
import { provisionBrowserAuth } from "../../scripts/deploy/provision-browser-auth.mjs";
describe("bounded approved browser credential setup", () => {
  it("stores new credential material only through Vault and returns fixed safe facts", async () => {
    const vault = { exists: vi.fn(async () => false), set: vi.fn(async () => {}) };
    const graph = { addPassword: vi.fn(async () => ({ keyId: "synthetic-id", secretText: "synthetic-secret-canary" })), removePassword: vi.fn(async () => {}) };
    const result = await provisionBrowserAuth(vault, graph, () => "a".repeat(64));
    expect(result).toEqual({ browserAuthSecretsProvisioned: true });
    expect(vault.set).toHaveBeenCalledWith("cw-portal-oidc-client-secret", "synthetic-secret-canary");
    expect(vault.set).toHaveBeenCalledWith("cw-browser-flow-key", "a".repeat(64));
    expect(graph.removePassword).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/synthetic-secret|aaaa/);
  });
  it("never overwrites existing product secrets", async () => {
    const graph = { addPassword: vi.fn(), removePassword: vi.fn() };
    await expect(provisionBrowserAuth({ exists: async () => true, set: vi.fn() }, graph)).rejects.toThrow(/^browser_auth_provisioning_failed$/);
    expect(graph.addPassword).not.toHaveBeenCalled();
  });
  it("removes the new credential on failed Vault provisioning without leaking raw errors", async () => {
    const graph = { addPassword: vi.fn(async () => ({ keyId: "synthetic-id", secretText: "synthetic-secret" })), removePassword: vi.fn(async () => {}) };
    await expect(provisionBrowserAuth({ exists: async () => false, set: async () => { throw new Error("synthetic-secret"); } }, graph)).rejects.toThrow(/^browser_auth_provisioning_failed$/);
    expect(graph.removePassword).toHaveBeenCalledWith("synthetic-id");
  });
  it("reports cleanup failure as incomplete and fails closed", async () => {
    await expect(provisionBrowserAuth({ exists: async () => false, set: async () => { throw new Error(); } }, {
      addPassword: async () => ({ keyId: "synthetic-id", secretText: "synthetic-secret" }), removePassword: async () => { throw new Error("raw-private-data"); }
    })).rejects.toThrow(/^browser_credential_cleanup_required$/);
  });
});
