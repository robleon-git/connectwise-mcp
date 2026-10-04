import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import worker, { createWorker } from "../worker.js";
import fixture from "./worker-fixture.js";
import { CwManageClient } from "../api-client.js";
import { getConfig, validateConfig } from "../config.js";
import { ApiRequestError, ConfigurationError, logDiagnostic, safeErrorMessage } from "../diagnostics.js";
import { createHttpHandler, requireHttpAuthentication } from "../http-server.js";

const config = { baseUrl: "https://cw.example", companyId: "secret-company", publicKey: "secret-public", privateKey: "secret-private", clientId: "secret-client" };
const writes = ["cw_create_ticket", "cw_add_ticket_note", "cw_update_ticket", "cw_create_company", "cw_update_company", "cw_create_contact", "cw_create_project", "cw_add_project_ticket_note", "cw_create_time_entry", "cw_update_time_entry", "cw_delete_time_entry", "cw_create_activity", "cw_create_catalog_item", "cw_update_catalog_item", "cw_create_agreement_addition", "cw_update_agreement_addition"];
const reads = ["cw_search_tickets", "cw_get_ticket", "cw_get_ticket_notes", "cw_search_companies", "cw_get_company", "cw_search_contacts", "cw_get_contact", "cw_search_projects", "cw_get_project", "cw_search_project_tickets", "cw_get_project_ticket", "cw_get_project_ticket_notes", "cw_search_time_entries", "cw_get_time_entry", "cw_search_members", "cw_get_member", "cw_search_configurations", "cw_get_configuration", "cw_list_boards", "cw_list_priorities", "cw_list_statuses", "cw_search_activities", "cw_get_activity", "cw_search_catalog_items", "cw_get_catalog_item", "cw_list_catalog_categories", "cw_list_catalog_subcategories", "cw_list_manufacturers", "cw_test_connection", "cw_search_agreements", "cw_get_agreement", "cw_get_agreement_additions", "cw_search_invoices", "cw_get_invoice", "cw_search_opportunities", "cw_get_opportunity", "cw_search_opportunity_forecasts", "cw_search_opportunity_notes", "cw_search_sales_stages"];
const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
async function rpc(method: string, params: unknown) {
  return fixture.fetch(new Request("https://service.example/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), { AUTH_MODE: "gateway" });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Phase 1 read-only MCP", () => {
  it("exposes exactly the original 39 read tools", async () => {
    const body = await (await rpc("tools/list", {})).json() as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([...reads].sort());
  });
  it.each(writes)("does not register or execute %s", async name => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const body = await (await rpc("tools/call", { name, arguments: {} })).json();
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["POST", "PATCH", "DELETE", "PUT"])("blocks client %s as defense in depth", async method => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(new CwManageClient(config).request(method, "/service/tickets")).rejects.toThrow(/disabled/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([404, 405])("preserves allNotes fallback on %s", async status => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("sensitive error body", { status }))
      .mockResolvedValueOnce(Response.json([{ id: 1, text: "existing note" }]));
    vi.stubGlobal("fetch", fetch);
    const body = await (await rpc("tools/call", { name: "cw_get_ticket_notes", arguments: { id: 7 } })).text();
    expect(body).toContain("existing note");
    expect(fetch.mock.calls[0][0]).toContain("/allNotes");
    expect(fetch.mock.calls[1][0]).toContain("/notes");
  });

});
describe("safe diagnostics", () => {
  it("never stringifies raw errors, causes, headers, or token data", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "Bearer SECRET Authorization secret-private";
    const object = { message: secret, headers: { Authorization: secret }, cause: new Error(secret), toString: () => secret };
    logDiagnostic("transport.failed", object);
    logDiagnostic("server.failed", new Error(secret, { cause: object }));
    const typed = new ApiRequestError(401); typed.message = secret;
    logDiagnostic("transport.failed", typed);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    expect(safeErrorMessage(object)).toMatch(/redacted/);
    expect(safeErrorMessage(typed)).toBe("ConnectWise API returned 401.");
  });
  it("suppresses ConnectWise error bodies and network errors", async () => {
    const secret = `${config.privateKey} Authorization Basic abc customer data`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(secret, { status: 401 })).mockRejectedValueOnce(new Error(secret)));
    const client = new CwManageClient(config);
    await expect(client.get("/service/tickets")).rejects.toThrow("ConnectWise API returned 401.");
    await expect(client.get("/service/tickets")).rejects.toThrow("ConnectWise request failed; details redacted.");
  });
  it("returns redacted errors through MCP", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret-private Authorization Bearer secret")));
    const body = await (await rpc("tools/call", { name: "cw_get_company", arguments: { id: 1 } })).text();
    expect(body).not.toContain("secret-private"); expect(body).not.toContain("Bearer secret");
    expect(body).toMatch(/redacted/);
  });
  it("validates URLs without disclosing configuration", () => {
    expect(() => validateConfig({ ...config, baseUrl: "https://user:secret-private@cw.example" })).toThrow(ConfigurationError);
    expect(() => validateConfig({ ...config, baseUrl: "http://cw.example" })).toThrow(ConfigurationError);
    expect(getConfig({ CW_MANAGE_COMPANY_ID: "missing" })).toBeNull();
  });
});
describe("HTTP authentication boundary", () => {
  it.each([{}, { MCP_OAUTH_ENABLED: "true" }, { MCP_BEARER_TOKEN: "secret" }, { CONDUIT_S2S_SECRET: "secret" }, { MCP_ALLOW_UNAUTHENTICATED_LOCAL: "true" }, { MCP_HTTP_HOST: "127.0.0.1" }, { MCP_HTTP_HOST: "127.0.0.1", MCP_ALLOW_UNAUTHENTICATED_LOCAL: "true", NODE_ENV: "production" }])("rejects unconfigured remote exposure (%j)", env => {
    expect(() => requireHttpAuthentication(env)).toThrow(/authentication/);
  });
  it("refuses actual CLI HTTP startup with no authenticator", () => {
    const result = spawnSync(process.execPath, ["dist/index.js"], {
      env: { ...process.env, MCP_TRANSPORT: "http", MCP_HTTP_HOST: "0.0.0.0", MCP_ALLOW_UNAUTHENTICATED_LOCAL: "false", AUTH_MODE: "env" },
      encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/HTTP requires configured authentication/);
    expect(result.stdout).toBe("");
  });
  it("allows only explicit non-production loopback testing", async () => {
    expect(await requireHttpAuthentication({ MCP_HTTP_HOST: "127.0.0.1", MCP_ALLOW_UNAUTHENTICATED_LOCAL: "true" })({} as IncomingMessage)).toBe(true);
  });
  it("rejects gateway mode", () => {
    expect(() => requireHttpAuthentication({ AUTH_MODE: "gateway" }, async () => true)).toThrow(/Per-request/);
  });
  it("enforces the Node gate before resolving secrets or starting MCP", async () => {
    const provider = vi.fn(); const auth = vi.fn(async () => false);
    const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn(), headersSent: false });
    await createHttpHandler({ authenticate: auth, configProvider: provider })({ url: "/mcp", method: "POST", headers: { authorization: "Bearer secret" } } as IncomingMessage, res as unknown as ServerResponse);
    expect(res.writeHead).toHaveBeenCalledWith(401, expect.anything()); expect(provider).not.toHaveBeenCalled();
  });
  it("rejects browser origins and caller-supplied CW headers", async () => {
    const provider = vi.fn(); const auth = vi.fn(async () => true);
    for (const requestHeaders of [{ origin: "https://evil.example" }, { "x-cw-private-key": "secret" }]) {
      const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn(), headersSent: false });
      await createHttpHandler({ authenticate: auth, configProvider: provider })({ url: "/mcp", method: "POST", headers: requestHeaders } as IncomingMessage, res as unknown as ServerResponse);
      expect(res.writeHead.mock.calls[0][0]).toBeGreaterThanOrEqual(400);
    }
    expect(provider).not.toHaveBeenCalled();
  });
  it("locks the default Worker even with full credentials", async () => {
    const request = new Request("https://service.example/mcp", { method: "POST" });
    const response = await worker.fetch(request, { MCP_OAUTH_ENABLED: "true", CW_MANAGE_PRIVATE_KEY: "secret" });
    expect(response.status).toBe(503);
  });
  it("requires successful Worker authentication before configuration", async () => {
    const provider = vi.fn();
    const response = await createWorker({ authenticate: async () => false, configProvider: provider }).fetch(new Request("https://service.example/mcp", { method: "POST" }), {});
    expect(response.status).toBe(401); expect(provider).not.toHaveBeenCalled();
  });
});
