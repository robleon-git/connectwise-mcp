import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createConnectWiseConfigLoader, createAzureSecretReader, CW_UNCONFIGURED_PLACEHOLDER } from "../config-loader.js";
import { createMcpServer } from "../mcp-server.js";
import { CwManageClient } from "../api-client.js";
import { logDiagnostic } from "../diagnostics.js";
import { createHttpHandler } from "../http-server.js";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

// Synthetic canaries only. No real credential material is used in tests.
const vaultEnv = { NODE_ENV: "production", CW_CONFIG_SOURCE: "key-vault", CW_KEY_VAULT_URI: "https://cw-pilot.vault.azure.net",
  CW_MANAGE_URL: "https://cw.example/", CW_MANAGE_COMPANY_ID: "test-company", CW_MANAGE_CLIENT_ID: "test-client" };
const canaries = { publicKey: "synthetic-public-canary", privateKey: "synthetic-private-canary" };
const config = { baseUrl: "https://cw.example", companyId: "test-company", clientId: "test-client", ...canaries, rejectUnauthorized: true };
const azure = vi.hoisted(() => {
  const getSecret = vi.fn();
  const logger = () => Object.fromEntries(["error", "warning", "info", "verbose"].map(level => [level,
    Object.assign(vi.fn(), { log: vi.fn(), enabled: true })]));
  return { getSecret, secretLogger: logger(), identityLogger: logger(),
    client: vi.fn(function (_uri: string, _credential: unknown, _options: unknown) { return { getSecret }; }),
    managed: vi.fn(function () {}), default: vi.fn(function () {}), clientConstructed: vi.fn() };
});
vi.mock("@azure/keyvault-secrets", () => ({ SecretClient: azure.client, logger: azure.secretLogger }));
vi.mock("@azure/identity", () => ({ ManagedIdentityCredential: azure.managed,
  DefaultAzureCredential: azure.default, logger: azure.identityLogger }));
vi.mock("../api-client.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../api-client.js")>();
  return { ...actual, CwManageClient: class extends actual.CwManageClient {
    constructor(value: ConstructorParameters<typeof actual.CwManageClient>[0]) {
      super(value); azure.clientConstructed();
    }
  } };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function connected(configOverride: typeof config | null) {
  const server = createMcpServer(configOverride);
  const client = new Client({ name: "config-loader-offline-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("central ConnectWise config loader", () => {
  it("preserves env compatibility and normalization without touching Azure", async () => {
    const factory = vi.fn();
    const load = createConnectWiseConfigLoader({ env: { CW_MANAGE_URL: "https://cw.example///",
      CW_MANAGE_COMPANY_ID: "test-company", CW_MANAGE_CLIENT_ID: "test-client",
      CW_MANAGE_PUBLIC_KEY: canaries.publicKey, CW_MANAGE_PRIVATE_KEY: canaries.privateKey }, createSecretReader: factory });
    expect(await load()).toEqual(config); expect(factory).not.toHaveBeenCalled();
  });
  it("missing config keeps Stage A without constructing a CW client or making requests", async () => {
    const factory = vi.fn(), request = vi.spyOn(CwManageClient.prototype, "request"), fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const load = createConnectWiseConfigLoader({ env: {}, createSecretReader: factory });
    expect(await load()).toBeNull();
    const session = await connected(await load() as null);
    try {
      expect((await session.client.listTools()).tools.map(tool => tool.name)).toEqual(["cw_test_connection"]);
      const result = await session.client.callTool({ name: "cw_test_connection", arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).toContain("Error: Missing ConnectWise Manage credentials.");
      expect(request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled();
      expect(azure.clientConstructed).not.toHaveBeenCalled();
    } finally { await session.close(); }
  });
  it("does not resolve Azure SDK secrets before HTTP authentication", async () => {
    const read = vi.fn();
    const load = createConnectWiseConfigLoader({ env: vaultEnv, createSecretReader: read });
    const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn(), headersSent: false });
    await createHttpHandler({ authenticate: async () => false, configProvider: load })({ url: "/mcp", method: "POST", headers: {} } as IncomingMessage,
      res as unknown as ServerResponse);
    expect(read).not.toHaveBeenCalled(); expect(res.writeHead.mock.calls[0][0]).toBe(401);
  });
  it("resolves only the two fixed vault names and ignores environment keys in vault mode", async () => {
    const read = vi.fn(async name => name === "connectwise-public-key" ? canaries.publicKey : canaries.privateKey);
    const factory = vi.fn(async (_uri: string) => read);
    const load = createConnectWiseConfigLoader({ env: { ...vaultEnv, CW_MANAGE_PUBLIC_KEY: "ignored", CW_MANAGE_PRIVATE_KEY: "ignored" },
      createSecretReader: factory });
    expect(await load()).toEqual(config);
    expect(factory.mock.calls[0][0]).toBe("https://cw-pilot.vault.azure.net");
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(["connectwise-private-key", "connectwise-public-key"]);
  });
  it.each([undefined, "", "  ", CW_UNCONFIGURED_PLACEHOLDER, CW_UNCONFIGURED_PLACEHOLDER + "\n"])("absent/placeholder secret preserves Stage A (%s)", async missing => {
    const load = createConnectWiseConfigLoader({ env: vaultEnv,
      createSecretReader: async () => async name => name === "connectwise-public-key" ? canaries.publicKey : missing });
    expect(await load()).toBeNull();
  });
  it("absent nonsecret configuration avoids vault lookup", async () => {
    const factory = vi.fn();
    expect(await createConnectWiseConfigLoader({ env: { CW_CONFIG_SOURCE: "key-vault" }, createSecretReader: factory })()).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });
  it.each([{ CW_CONFIG_SOURCE: "other" }, { CW_KEY_VAULT_URI: "http://cw-pilot.vault.azure.net" },
    { CW_KEY_VAULT_URI: "https://attacker.example" }, { CW_KEY_VAULT_URI: "https://cw-pilot.vault.azure.net?secret=value" },
    { CW_MANAGE_URL: "http://cw.example" }, { CW_MANAGE_REJECT_UNAUTHORIZED: "false" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" }])("rejects unsafe configuration before vault access (%j)", async change => {
    const factory = vi.fn();
    await expect(createConnectWiseConfigLoader({ env: { ...vaultEnv, ...change }, createSecretReader: factory })()).rejects.toThrow("Invalid service configuration");
    expect(factory).not.toHaveBeenCalled();
  });
  it("coalesces loads and expires credentials after 60 seconds without stale-on-error fallback", async () => {
    let time = 0;
    const read = vi.fn(async name => name === "connectwise-public-key" ? canaries.publicKey : canaries.privateKey);
    const load = createConnectWiseConfigLoader({ env: vaultEnv, now: () => time, createSecretReader: async () => read });
    expect(await Promise.all([load(), load()])).toEqual([config, config]);
    expect(read).toHaveBeenCalledTimes(2);
    time = 59000; expect(await load()).toEqual(config); expect(read).toHaveBeenCalledTimes(2);
    time = 60000; read.mockRejectedValue(new Error(`${canaries.privateKey} Authorization Bearer synthetic-token`));
    await expect(load()).rejects.toThrow("details redacted");
    await expect(load()).rejects.toThrow("details redacted");
  });
  it("vault failures never expose raw errors, credentials, headers or token data", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const load = createConnectWiseConfigLoader({ env: vaultEnv, createSecretReader: async () => async () => {
      throw new Error(`${canaries.publicKey} ${canaries.privateKey} Authorization Bearer synthetic-token`);
    } });
    try { await load(); expect.fail("must reject"); } catch (error) {
      expect(String(error)).not.toMatch(/synthetic-|Authorization|Bearer/); logDiagnostic("transport.failed", error);
    }
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(/synthetic-|Authorization|Bearer/);
  });
});

describe("official Azure SDK adapter", () => {
  it("uses managed identity in production and only GET-secret operations with suppressed SDK sinks", async () => {
    azure.getSecret.mockResolvedValue({ value: canaries.publicKey });
    const read = await createAzureSecretReader("https://cw-pilot.vault.azure.net", vaultEnv);
    expect(await read("connectwise-public-key")).toBe(canaries.publicKey);
    expect(azure.managed).toHaveBeenCalledOnce(); expect(azure.default).not.toHaveBeenCalled();
    expect(azure.getSecret).toHaveBeenCalledWith("connectwise-public-key", expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
    expect(azure.client.mock.calls[0][2]).toMatchObject({ retryOptions: { maxRetries: 2 }, redirectOptions: { handleRedirects: false, maxRetries: 0 } });
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const logger of [azure.secretLogger, azure.identityLogger]) {
      for (const level of ["error", "warning", "info", "verbose"]) logger[level].log(canaries.privateKey);
    }
    expect(logs).not.toHaveBeenCalled();
  });
  it("supports DefaultAzureCredential for nonproduction local vault testing", async () => {
    await createAzureSecretReader("https://cw-pilot.vault.azure.net", { NODE_ENV: "development" });
    expect(azure.default).toHaveBeenCalledOnce(); expect(azure.managed).not.toHaveBeenCalled();
  });
  it("distinguishes missing secrets from permission/network errors without leaking SDK errors", async () => {
    const read = await createAzureSecretReader("https://cw-pilot.vault.azure.net", vaultEnv);
    azure.getSecret.mockRejectedValueOnce({ statusCode: 404, message: canaries.privateKey });
    expect(await read("connectwise-private-key")).toBeUndefined();
    azure.getSecret.mockRejectedValueOnce({ statusCode: 403, message: canaries.privateKey, headers: { Authorization: "Bearer synthetic-token" } });
    await expect(read("connectwise-private-key")).rejects.toThrow("details redacted");
  });
});

describe("Stage B GET-only connectivity", () => {
  it("returns only sanitized success, discarding arbitrary system-info response data", async () => {
    const fetch = vi.fn(async (_input: unknown, _options?: unknown) => Response.json({ publicKey: canaries.publicKey, privateKey: canaries.privateKey, licensing: "customer-data" }));
    vi.stubGlobal("fetch", fetch);
    const session = await connected(config);
    try {
      const result = await session.client.callTool({ name: "cw_test_connection", arguments: {} });
      expect(result).toMatchObject({ isError: false, content: [{ type: "text", text: '{"connected":true}' }] });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][0]).toBe("https://cw.example/v4_6_release/apis/3.0/system/info");
      expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
      expect(JSON.stringify(result)).not.toMatch(/synthetic-|customer-data|Authorization/);
    } finally { await session.close(); }
  });
  it.each([401, 403, 500])("sanitizes a CW HTTP %s failure", async status => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`${canaries.privateKey} Authorization raw body`, { status })));
    const session = await connected(config);
    try {
      const result = await session.client.callTool({ name: "cw_test_connection", arguments: {} });
      expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: JSON.stringify({ connected: false,
        error: status === 500 ? "connection_failed" : "authentication_failed", httpStatus: status }) }] });
      expect(JSON.stringify([result, ...logs.mock.calls])).not.toMatch(/synthetic-|Authorization|raw body/);
    } finally { await session.close(); }
  });
  it("never exposes raw network exceptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(`${canaries.privateKey} Authorization Bearer token`); }));
    const session = await connected(config);
    try {
      expect(await session.client.callTool({ name: "cw_test_connection", arguments: {} })).toMatchObject({ isError: true,
        content: [{ type: "text", text: '{"connected":false,"error":"connection_failed"}' }] });
    } finally { await session.close(); }
  });
  it("exposes exactly the existing 39 read tools with no writes after vault loading", async () => {
    const loaded = await createConnectWiseConfigLoader({ env: vaultEnv,
      createSecretReader: async () => async name => name === "connectwise-public-key" ? canaries.publicKey : canaries.privateKey })();
    const session = await connected(loaded as typeof config);
    try {
      const tools = (await session.client.listTools()).tools;
      expect(tools).toHaveLength(39); expect(tools.some(tool => tool.name === "cw_test_connection")).toBe(true);
      expect(tools.every(tool => tool.annotations?.readOnlyHint === true)).toBe(true);
      expect(tools.map(tool => tool.name).join(" ")).not.toMatch(/cw_(?:create|update|delete|add)_/);
      // Existing phase1-hardening tests independently compare the full 39-name inventory.
    } finally { await session.close(); }
  });
});
