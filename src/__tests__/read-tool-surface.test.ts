import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";
import { CwManageClient } from "../api-client.js";
// @ts-expect-error Local operator reference has no TypeScript declarations.
import { EXPECTED_READ_TOOLS } from "../../scripts/read-only-tool-inventory.mjs";

const config = { baseUrl: "https://cw.example", companyId: "synthetic-company", publicKey: "synthetic-public",
  privateKey: "synthetic-private", clientId: "synthetic-integration-client", rejectUnauthorized: true };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function session(clientId?: string) {
  const server = createMcpServer({ ...config, clientId });
  const client = new Client({ name: "read-surface-offline-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(right); await client.connect(left);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("connected Stage B exact read surface", () => {
  it.each(["synthetic-integration-client", undefined])("registers the exact 39 tools with no writes (clientId=%s)", async clientId => {
    const value = await session(clientId);
    try {
      const tools = (await value.client.listTools()).tools;
      expect(tools.map(tool => tool.name).sort()).toEqual([...EXPECTED_READ_TOOLS].sort());
      expect(tools).toHaveLength(39);
      expect(new Set(tools.map(tool => tool.name)).size).toBe(39);
      expect(tools.every(tool => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false)).toBe(true);
      expect(tools.some(tool => /cw_(create|update|delete|add)_/.test(tool.name))).toBe(false);
    } finally { await value.close(); }
  });
  it.each(EXPECTED_READ_TOOLS as string[])("%s executes only GET through the production client", async name => {
    const request = vi.spyOn(CwManageClient.prototype, "request");
    const fetch = vi.fn(async (input: string, _options: RequestInit) => Response.json(
      new URL(input).pathname === "/v4_6_release/apis/3.0/service/tickets/1" ? { id: 1 } : []));
    vi.stubGlobal("fetch", fetch);
    const value = await session(config.clientId);
    try {
      const result = await value.client.callTool({ name, arguments: { id: 1, boardId: 1, agreementId: 1,
        opportunityId: 1, pageSize: 1 } });
      expect(result.isError).not.toBe(true);
      expect(request).toHaveBeenCalled(); expect(fetch).toHaveBeenCalled();
      expect(request.mock.calls.every(call => call[0] === "GET")).toBe(true);
      for (const [, options] of fetch.mock.calls) {
        expect(options.method).toBe("GET");
        expect(options.redirect).toBe("error");
        expect(new Headers(options.headers).get("clientId")).toBe(config.clientId);
        expect(options.body).toBeUndefined();
      }
      if (name === "cw_test_connection") {
        expect(result).toMatchObject({ content: [{ type: "text", text: '{"connected":true}' }] });
        expect(fetch).toHaveBeenCalledOnce();
        expect(new URL(fetch.mock.calls[0][0]).pathname).toBe("/v4_6_release/apis/3.0/system/info");
      }
    } finally { await value.close(); }
  });
});
