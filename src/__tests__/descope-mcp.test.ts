import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { EventEmitter } from "node:events";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createDescopeMcpAuthenticator, getDescopeMcpConfig, validateDescopeMcpConfig,
  type DescopeMcpConfig } from "../auth/descope-mcp.js";
import { createHttpHandler } from "../http-server.js";
import { CwManageClient } from "../api-client.js";

// Synthetic identifiers; keys/tokens are generated in memory and never written.
const authConfig: DescopeMcpConfig = {
  issuer: "https://identity.example/v1/apps/agentic/Ptest/RStest",
  jwksUri: "https://identity.example/Ptest/.well-known/jwks.json",
  resourceUri: "https://api.example/mcp", requiredScope: "connectwise.read",
  approvedUserId: "approved-test-user", approvedUserClaim: "/user/id",
};
const cwConfig = { baseUrl: "https://cw.example", companyId: "test-company",
  publicKey: "test-public", privateKey: "test-private", clientId: "test-client" };
const headers = { Accept: "application/json, text/event-stream", "Content-Type": "application/json" };
interface RpcResponse {
  error?: unknown;
  result: { isError?: boolean; tools: { name: string; securitySchemes: unknown;
    _meta: { securitySchemes: unknown }; annotations: { readOnlyHint: boolean } }[] };
}
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongPair: Awaited<ReturnType<typeof generateKeyPair>>;
let keyResolver: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256"); wrongPair = await generateKeyPair("RS256");
  keyResolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test", alg: "RS256" }] });
});
afterEach(() => vi.restoreAllMocks());

async function signed(overrides: JWTPayload = {}, wrongSignature = false) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: authConfig.issuer, aud: authConfig.resourceUri,
    sub: "agent-test-subject", user: { id: authConfig.approvedUserId }, scope: "connectwise.read",
    iat: now, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(wrongSignature ? wrongPair.privateKey : pair.privateKey);
}
function request(authorization?: string): IncomingMessage {
  return { url: "/mcp", method: "POST", headers: authorization ? { authorization } : {},
    rawHeaders: authorization ? ["Authorization", authorization] : [] } as IncomingMessage;
}
function mockResponse() {
  return Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn(), headersSent: false });
}

describe("Descope MCP configuration", () => {
  it("refuses missing/partial configuration, generic issuers and unsafe URLs", () => {
    expect(getDescopeMcpConfig({})).toBeUndefined();
    expect(() => getDescopeMcpConfig({ MCP_RESOURCE_URI: authConfig.resourceUri })).toThrow(/authentication/);
    for (const change of [{ issuer: "https://login.microsoftonline.com/tenant/v2.0" },
      { issuer: "https://identity.example/Ptest" }, { issuer: "https://identity.example/v1/apps/Ptest" },
      { jwksUri: "http://identity.example/keys" }, { jwksUri: "https://secret@identity.example/keys" },
      { issuer: authConfig.issuer + "/" }, { resourceUri: "http://api.example/mcp" },
      { resourceUri: "https://api.example/mcp?secret=value" }, { approvedUserId: "" },
      { approvedUserClaim: "" }, { approvedUserClaim: "/invalid~pointer" }, { requiredScope: "connectwise.write" }]) {
      expect(() => validateDescopeMcpConfig({ ...authConfig, ...change })).toThrow(/authentication/);
    }
  });
  it("accepts exact MCP issuers and requires explicit identity mapping", () => {
    expect(getDescopeMcpConfig({ DESCOPE_MCP_ISSUER: authConfig.issuer,
      DESCOPE_MCP_JWKS_URI: authConfig.jwksUri, MCP_RESOURCE_URI: authConfig.resourceUri,
      MCP_APPROVED_USER_ID: authConfig.approvedUserId, MCP_APPROVED_USER_CLAIM: "/user/id" })).toEqual(authConfig);
  });
});

describe("Descope signed access-token policy", () => {
  it("accepts the exact audience, scope and explicit immutable user claim", async () => {
    const auth = createDescopeMcpAuthenticator(authConfig, keyResolver);
    expect(await auth(request(`Bearer ${await signed()}`))).toEqual({ authenticated: true });
    expect(await auth(request(`bearer ${await signed({ aud: ["other", authConfig.resourceUri], scope: "offline_access connectwise.read" })}`)))
      .toEqual({ authenticated: true });
  });
  it.each(["", "Basic abc", "Bearer abc", "Bearer a.b.", "Bearer a.b.c extra", "Bearer  a.b.c",
    "Bearer a.b.c,Bearer a.b.c", "Bearer a.b.c\n", `Bearer ${"a".repeat(17000)}.b.c`])("rejects malformed header %s", async header => {
    const auth = createDescopeMcpAuthenticator(authConfig, keyResolver);
    expect(await auth(request(header))).toMatchObject({ authenticated: false, status: 401 });
  });
  it("rejects duplicate authorization headers", async () => {
    const req = request(`Bearer ${await signed()}`);
    req.rawHeaders.push("authorization", req.headers.authorization!);
    expect(await createDescopeMcpAuthenticator(authConfig, keyResolver)(req)).toMatchObject({ authenticated: false, status: 401 });
  });
  it("fails closed on JWKS/network failure without exposing errors", async () => {
    const auth = createDescopeMcpAuthenticator(authConfig, async () => { throw new Error("Bearer sensitive-token secret-network-data"); });
    const result = await auth(request(`Bearer ${await signed()}`));
    expect(result).toEqual({ authenticated: false, status: 401, error: "invalid_token" });
  });
  it("does not substitute client input or session subject for the approved-user claim", async () => {
    const auth = createDescopeMcpAuthenticator(authConfig, keyResolver);
    const req = request(`Bearer ${await signed({ user: undefined, sub: authConfig.approvedUserId })}`);
    req.headers["x-user-id"] = authConfig.approvedUserId;
    expect(await auth(req)).toMatchObject({ authenticated: false, status: 403 });
  });
  it("supports an explicitly verified /sub mapping, without an implicit fallback", async () => {
    const auth = createDescopeMcpAuthenticator({ ...authConfig, approvedUserClaim: "/sub" }, keyResolver);
    expect(await auth(request(`Bearer ${await signed({ sub: authConfig.approvedUserId })}`))).toEqual({ authenticated: true });
  });
});

const deniedCases: [string, JWTPayload, number, string][] = [
  ["wrong issuer", { iss: "https://other.example/v1/apps/agentic/Ptest/RStest" }, 401, "invalid_token"],
  ["direct Entra token", { iss: "https://login.microsoftonline.com/tenant/v2.0" }, 401, "invalid_token"],
  ["generic Descope session token", { iss: "https://identity.example/Ptest" }, 401, "invalid_token"],
  ["generic Descope app token", { iss: "https://identity.example/v1/apps/Ptest" }, 401, "invalid_token"],
  ["another MCP issuer using shared project keys", { iss: "https://identity.example/v1/apps/agentic/Ptest/RSother" }, 401, "invalid_token"],
  ["wrong audience", { aud: "https://api.example/other" }, 401, "invalid_token"],
  ["audience prefix", { aud: authConfig.resourceUri + "/" }, 401, "invalid_token"],
  ["expired token", { exp: 1 }, 401, "invalid_token"],
  ["missing expiry", { exp: undefined }, 401, "invalid_token"],
  ["future not-before", { nbf: 9999999999 }, 401, "invalid_token"],
  ["missing scope", { scope: undefined }, 403, "insufficient_scope"],
  ["scope substring", { scope: "connectwise.read.extra" }, 403, "insufficient_scope"],
  ["array scope", { scope: ["connectwise.read"] }, 403, "insufficient_scope"],
  ["unauthorized user", { user: { id: "other-user" } }, 403, "forbidden"],
];

describe("HTTP auth before service-owned secrets", () => {
  it.each(deniedCases)("rejects %s before configuration or CW calls", async (_, claims, status, error) => {
    const provider = vi.fn(); const get = vi.spyOn(CwManageClient.prototype, "get");
    const response = mockResponse(); const token = await signed(claims);
    await createHttpHandler({ authConfig, authenticate: createDescopeMcpAuthenticator(authConfig, keyResolver),
      configProvider: provider })(request(`Bearer ${token}`), response as unknown as ServerResponse);
    expect(response.writeHead).toHaveBeenCalledWith(status, expect.objectContaining({ "WWW-Authenticate": expect.stringContaining("oauth-protected-resource/mcp") }));
    expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error }));
    expect(provider).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
    expect(JSON.stringify(response.end.mock.calls)).not.toContain(token);
  });
  it("missing token returns a discovery challenge without contacting CW", async () => {
    const provider = vi.fn(); const response = mockResponse();
    await createHttpHandler({ authConfig, authenticate: createDescopeMcpAuthenticator(authConfig, keyResolver),
      configProvider: provider })(request(), response as unknown as ServerResponse);
    expect(response.writeHead).toHaveBeenCalledWith(401, expect.objectContaining({ "WWW-Authenticate":
      'Bearer resource_metadata="https://api.example/.well-known/oauth-protected-resource/mcp"' }));
    expect(provider).not.toHaveBeenCalled();
  });
  it("malformed Bearer input never resolves configuration or constructs a CW request", async () => {
    const provider = vi.fn(); const get = vi.spyOn(CwManageClient.prototype, "get");
    const response = mockResponse();
    await createHttpHandler({ authConfig, authenticate: createDescopeMcpAuthenticator(authConfig, keyResolver),
      configProvider: provider })(request("Bearer malformed"), response as unknown as ServerResponse);
    expect(response.writeHead.mock.calls[0][0]).toBe(401);
    expect(provider).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
  it("invalid signature is rejected before resolving secrets", async () => {
    const provider = vi.fn(); const response = mockResponse();
    await createHttpHandler({ authConfig, authenticate: createDescopeMcpAuthenticator(authConfig, keyResolver),
      configProvider: provider })(request(`Bearer ${await signed({}, true)}`), response as unknown as ServerResponse);
    expect(response.writeHead.mock.calls[0][0]).toBe(401); expect(provider).not.toHaveBeenCalled();
  });
  it("unsigned and symmetric tokens cannot bypass the RS256 allowlist", async () => {
    const auth = createDescopeMcpAuthenticator(authConfig, keyResolver);
    const token = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).sign(new Uint8Array(32));
    expect(await auth(request(`Bearer ${token}`))).toMatchObject({ authenticated: false, status: 401 });
    expect(await auth(request("Bearer eyJhbGciOiJub25lIn0.e30."))).toMatchObject({ authenticated: false, status: 401 });
  });
  it("unexpected authenticator failures remain sanitized and fail closed", async () => {
    const provider = vi.fn(); const response = mockResponse();
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    await createHttpHandler({ authConfig, authenticate: async () => { throw new Error("Bearer SECRET token claims"); },
      configProvider: provider })(request(), response as unknown as ServerResponse);
    expect(response.writeHead.mock.calls[0][0]).toBe(401); expect(provider).not.toHaveBeenCalled();
    expect(JSON.stringify([...logs.mock.calls, ...response.end.mock.calls])).not.toContain("SECRET");
  });
});

describe("real HTTP MCP wire integration", () => {
  const provider = vi.fn(async () => cwConfig);
  let base: string;
  const server = createServer();
  beforeAll(async () => {
    const verifier = createDescopeMcpAuthenticator(authConfig, keyResolver);
    const handler = createHttpHandler({ authConfig, authenticate: verifier, configProvider: provider });
    server.on("request", (req, res) => { void handler(req, res); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  it("publishes canonical public PRM, without root alias or secret lookup", async () => {
    provider.mockClear();
    const response = await fetch(base + "/.well-known/oauth-protected-resource/mcp");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ resource: authConfig.resourceUri,
      authorization_servers: [authConfig.issuer], scopes_supported: ["connectwise.read"], bearer_methods_supported: ["header"] });
    expect(provider).not.toHaveBeenCalled();
    expect((await fetch(base + "/.well-known/oauth-protected-resource")).status).toBe(404);
  });
  it("initializes and advertises OAuth on all 39 read tools in actual wire output", async () => {
    const token = await signed();
    for (const method of ["initialize", "tools/list"]) {
      const params = method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: {},
        clientInfo: { name: "offline-test", version: "1" } } : {};
      const response = await fetch(base + "/mcp", { method: "POST", headers: { ...headers, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      expect(response.status).toBe(200);
      const body = await response.json() as RpcResponse;
      expect(body.error).toBeUndefined();
      if (method === "tools/list") {
        expect(body.result.tools).toHaveLength(39);
        for (const tool of body.result.tools) {
          expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: ["connectwise.read"] }]);
          expect(tool._meta.securitySchemes).toEqual(tool.securitySchemes);
          expect(tool.annotations.readOnlyHint).toBe(true);
          expect(tool.name).not.toMatch(/create|update|delete|add_ticket_note|add_project_ticket_note/);
        }
      }
    }
  });
  it("executes a safe GET only after authorization and config resolution", async () => {
    const get = vi.spyOn(CwManageClient.prototype, "get").mockResolvedValue({ id: 1 });
    const response = await fetch(base + "/mcp", { method: "POST", headers: { ...headers, Authorization: `Bearer ${await signed()}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "cw_get_company", arguments: { id: 1 } } }) });
    expect(response.status).toBe(200); expect((await response.json() as RpcResponse).result.isError).not.toBe(true);
    expect(get).toHaveBeenCalledWith("/company/companies/1");
  });
  it("authenticates each request, including following a successful request", async () => {
    provider.mockClear();
    const get = vi.spyOn(CwManageClient.prototype, "get");
    for (const method of ["initialize", "tools/list", "tools/call"]) {
      const response = await fetch(base + "/mcp", { method: "POST", headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }) });
      expect(response.status).toBe(401);
    }
    expect(provider).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled();
  });
});
