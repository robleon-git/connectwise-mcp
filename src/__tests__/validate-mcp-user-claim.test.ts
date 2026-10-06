import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createHttpHandler } from "../http-server.js";
import { createDescopeMcpAuthenticator } from "../auth/descope-mcp.js";

// Dynamic import keeps the standalone operator script outside TypeScript's app build.
const helperPath = "../../scripts/validate-mcp-user-claim.mjs";
interface Summary { resourceTokenVerified: boolean; approvedIdMatchPaths: string[];
  mcpInitializeSucceeded?: boolean; protocolVersion?: string; toolsListSucceeded?: boolean;
  toolCount?: number; toolNames?: string[]; failureStage?: string; httpStatus?: number }
interface Callback { redirectUri: string; code: Promise<string>; close: () => Promise<void> }
interface Helper {
  PILOT: { issuer: string; jwksUri: string; resourceUri: string; requiredScope: string; approvedUserId: string };
  verifyTokenAndFindPaths: (token: string, resolver: ReturnType<typeof createLocalJWKSet>) => Promise<Summary>;
  checkPilotEnvironment: (env: Record<string, string>) => void;
  validateDiscovery: (metadata: Record<string, unknown>) => Record<string, unknown>;
  freshLoginParameters: (metadata: Record<string, unknown>) => { prompt: string };
  createLoopbackCallback: (state: string, metadata: Record<string, unknown>, timeout?: number) => Promise<Callback>;
  runDiagnostic: (options: { fetchImpl: typeof fetch; openBrowser: (url: string) => Promise<boolean>;
    onAuthorizationUrl?: (url: string) => void | Promise<void>; keyResolver: ReturnType<typeof createLocalJWKSet>;
    env: Record<string, string>; callbackTimeoutMs?: number; freshLogin?: boolean }) => Promise<Summary>;
  main: (run: () => Promise<unknown>, output: (value: string) => void) => Promise<number>;
  discoverMcp: (token: string, verified: Summary, options: { fetchImpl: typeof fetch }) => Promise<Summary>;
}
const helper = await import(helperPath) as Helper;
const pilot = helper.PILOT;
const metadata = { issuer: pilot.issuer, jwks_uri: pilot.jwksUri,
  authorization_endpoint: pilot.issuer.replace("/v1/apps/agentic/", "/oauth2/v1/apps/agentic/") + "/authorize",
  token_endpoint: pilot.issuer.replace("/v1/apps/agentic/", "/oauth2/v1/apps/agentic/") + "/token",
  registration_endpoint: pilot.issuer.replace("/v1/apps/agentic/", "/v1/mgmt/mcp/client/") + "/register",
  response_types_supported: ["code"], code_challenge_methods_supported: ["S256"],
  scopes_supported: ["connectwise.read", "offline_access"], token_endpoint_auth_methods_supported: ["none"],
};
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), alg: "RS256", kid: "test" }] });
});
async function sign(payload: JWTPayload = {}) {
  return new SignJWT({ iss: pilot.issuer, aud: pilot.resourceUri, exp: Math.floor(Date.now() / 1000) + 300,
    sub: pilot.approvedUserId, scope: pilot.requiredScope, ...payload })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(pair.privateKey);
}

function sdkResponse(options?: RequestInit, failStage?: string, status = 403): Response {
  if (options?.method === "GET") return new Response(null, { status: 405 });
  const message = JSON.parse(options!.body as string);
  if (message.method === failStage) return new Response("sensitive response Bearer SECRET", { status });
  if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (message.method === "initialize") return Response.json({ jsonrpc: "2.0", id: message.id,
    result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: "synthetic-stage-a", version: "1" } } });
  expect(message.method).toBe("tools/list");
  return Response.json({ jsonrpc: "2.0", id: message.id,
    result: { tools: [{ name: "cw_test_connection", description: "Sensitive description must not be printed",
      inputSchema: { type: "object", properties: {} } }] } });
}

describe("local verified claim diagnostic", () => {
  it("finds the approved ID at /sub without returning claims", async () => {
    expect(await helper.verifyTokenAndFindPaths(await sign(), jwks))
      .toEqual({ resourceTokenVerified: true, approvedIdMatchPaths: ["/sub"] });
  });
  it("finds nested and array paths with exact comparison only", async () => {
    const token = await sign({ sub: "other", identity: { userId: pilot.approvedUserId },
      users: [{ id: pilot.approvedUserId }], substring: pilot.approvedUserId + "extra" });
    expect(await helper.verifyTokenAndFindPaths(token, jwks))
      .toEqual({ resourceTokenVerified: true, approvedIdMatchPaths: ["/identity/userId", "/users/0/id"] });
  });
  it("reports no match and exits 2", async () => {
    const summary = await helper.verifyTokenAndFindPaths(await sign({ sub: "another-user" }), jwks);
    const output = vi.fn();
    expect(await helper.main(async () => summary, output)).toBe(2);
    expect(output).toHaveBeenCalledExactlyOnceWith('{"resourceTokenVerified":true,"approvedIdMatchPaths":[]}');
  });
  it.each([
    ["wrong audience", { aud: "https://other.example/mcp" }],
    ["missing scope", { scope: undefined }],
    ["scope substring", { scope: "connectwise.read.extra" }],
    ["wrong issuer", { iss: "https://login.microsoftonline.com/tenant/v2.0" }],
    ["generic session issuer", { iss: "https://api.descope.com/project" }],
    ["expired", { exp: 1 }],
    ["future nbf", { nbf: 9999999999 }],
  ] as [string, JWTPayload][])("rejects %s with a fixed diagnostic error", async (_, claims) => {
    const token = await sign(claims);
    await expect(helper.verifyTokenAndFindPaths(token, jwks)).rejects.toThrow("Local OAuth diagnostic failed; details suppressed.");
  });
  it("cannot print token values or raw payloads, even from injected errors/results", async () => {
    const token = await sign({ access_token: "sensitive-access", refresh_token: "sensitive-refresh",
      email: "sensitive-email", assertion: "sensitive-assertion" });
    const result = await helper.verifyTokenAndFindPaths(token, jwks);
    const output = vi.fn();
    expect(await helper.main(async () => ({ ...result, access_token: token, refresh_token: "sensitive-refresh" }), output)).toBe(0);
    expect(output).toHaveBeenLastCalledWith('{"resourceTokenVerified":true,"approvedIdMatchPaths":["/sub"]}');
    expect(await helper.main(async () => { throw new Error(token); }, output)).toBe(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(token);
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/sensitive-|email|assertion|refresh_token/);
  });
  it("does not emit a JWT embedded in a claim name", async () => {
    const tokenKey = "eyJhbGciOiJSUzI1NiJ9.e30.synthetic-signature";
    const token = await sign({ sub: "other", [tokenKey]: pilot.approvedUserId });
    const output = vi.fn();
    expect(await helper.main(() => helper.verifyTokenAndFindPaths(token, jwks), output)).toBe(1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(tokenKey);
  });
  it("rejects conflicting nonsecret config and ignores the deployed claim setting", () => {
    expect(() => helper.checkPilotEnvironment({ MCP_RESOURCE_URI: "https://other.example/mcp" })).toThrow();
    expect(() => helper.checkPilotEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: "0" })).toThrow();
    expect(() => helper.checkPilotEnvironment({ MCP_APPROVED_USER_CLAIM: "/exp", MCP_RESOURCE_URI: pilot.resourceUri })).not.toThrow();
  });
  it("rejects an invalid signature without exposing the input token", async () => {
    const other = await generateKeyPair("RS256");
    const wrongJwks = createLocalJWKSet({ keys: [{ ...await exportJWK(other.publicKey), alg: "RS256", kid: "test" }] });
    await expect(helper.verifyTokenAndFindPaths(await sign(), wrongJwks)).rejects.toThrow("details suppressed");
  });
  it("rejects false discovery, omitted S256, and substituted endpoints", () => {
    for (const change of [{ issuer: "wrong" }, { jwks_uri: "https://other.example/keys" },
      { code_challenge_methods_supported: [] }, { token_endpoint: "https://other.example/token" },
      { registration_endpoint: "https://other.example/register" }, { token_endpoint_auth_methods_supported: ["client_secret_post"] }]) {
      expect(() => helper.validateDiscovery({ ...metadata, ...change })).toThrow();
    }
  });
});

describe("loopback callback", () => {
  it("binds IPv4 loopback, rejects wrong/duplicate state, then consumes one code", async () => {
    const callback = await helper.createLoopbackCallback("test-state", metadata, 5000);
    try {
      expect(new URL(callback.redirectUri).hostname).toBe("127.0.0.1");
      for (const query of ["?state=wrong&code=secret-code", "?state=test-state&state=test-state&code=secret-code",
        "?state=test-state&code=secret-code&iss=https://wrong.example"]) {
        const response = await fetch(callback.redirectUri + query);
        expect(response.status).toBe(400); expect(await response.text()).not.toContain("secret-code");
      }
      const response = await fetch(callback.redirectUri + "?state=test-state&code=synthetic-code");
      expect(response.status).toBe(200); expect(await callback.code).toBe("synthetic-code");
      expect((await fetch(callback.redirectUri + "?state=test-state&code=second-code")).status).toBe(400);
    } finally { await callback.close(); }
  });
  it("requires callback issuer if the AS advertises RFC 9207", async () => {
    const callback = await helper.createLoopbackCallback("state", { ...metadata, authorization_response_iss_parameter_supported: true }, 5000);
    try {
      expect((await fetch(callback.redirectUri + "?state=state&code=test-code")).status).toBe(400);
      const url = new URL(callback.redirectUri);
      url.search = new URLSearchParams({ state: "state", code: "test-code", iss: pilot.issuer }).toString();
      expect((await fetch(url)).status).toBe(200); expect(await callback.code).toBe("test-code");
    } finally { await callback.close(); }
  });
  it("times out without printing callback/token data", async () => {
    const callback = await helper.createLoopbackCallback("state", metadata, 20);
    try { await expect(callback.code).rejects.toThrow("details suppressed"); }
    finally { await callback.close(); }
  });
});

describe("mocked authorization-code / PKCE exchange", () => {
  it("requests only standard prompt=login and rejects an explicitly unsupported prompt", () => {
    for (const prompt_values_supported of [undefined, null, ["login", "consent"]]) {
      expect(helper.freshLoginParameters({ prompt_values_supported })).toEqual({ prompt: "login" });
    }
    for (const prompt_values_supported of [[], ["consent"], "login"]) {
      expect(() => helper.freshLoginParameters({ prompt_values_supported })).toThrow("details suppressed");
    }
  });
  it.each([[true, false, true], [false, false, true], [true, true, true], [true, true, false]])("uses resource/S256/public DCR/access_token (browser: %s, fresh: %s, approved: %s)", async (browserAvailable, freshLogin, approved) => {
    const token = await sign(approved ? {} : { sub: "unapproved-synthetic-subject" });
    let redirectUri = "", challenge = "";
    const remote = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      expect(options?.redirect).toBe("error");
      if (url === pilot.resourceUri) {
        expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${token}`);
        return sdkResponse(options);
      }
      if (url.endsWith("openid-configuration")) return Response.json(metadata);
      if (url === metadata.registration_endpoint) {
        const body = JSON.parse(options!.body as string);
        expect(body.token_endpoint_auth_method).toBe("none");
        expect(body.scope).toBe("connectwise.read offline_access");
        expect(body.grant_types).toEqual(["authorization_code", "refresh_token"]);
        redirectUri = body.redirect_uris[0];
        expect(new URL(redirectUri).hostname).toBe("127.0.0.1");
        return Response.json({ client_id: "synthetic-client", token_endpoint_auth_method: "none", redirect_uris: [redirectUri] });
      }
      expect(url).toBe(metadata.token_endpoint);
      const body = options!.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("resource")).toBe(pilot.resourceUri);
      expect(body.get("redirect_uri")).toBe(redirectUri);
      expect(body.get("code")).toBe("synthetic-code");
      expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(challenge);
      return Response.json({ token_type: "Bearer", access_token: token, refresh_token: "never-output-refresh", id_token: "never-output-id" });
    });
    const output = vi.fn();
    const authorizeLocally = async (url: string) => {
        const authorize = new URL(url);
        expect(authorize.origin + authorize.pathname).toBe(metadata.authorization_endpoint);
        expect(authorize.searchParams.get("resource")).toBe(pilot.resourceUri);
        expect(authorize.searchParams.get("scope")).toBe("connectwise.read offline_access");
        expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
        expect(authorize.searchParams.get("prompt")).toBe(freshLogin ? "login" : null);
        expect(authorize.searchParams.has("login_hint")).toBe(false);
        expect(authorize.searchParams.has("code_verifier")).toBe(false);
        challenge = authorize.searchParams.get("code_challenge")!;
        const callback = new URL(redirectUri);
        callback.search = new URLSearchParams({ code: "synthetic-code", state: authorize.searchParams.get("state")! }).toString();
        expect((await fetch(callback)).status).toBe(200);
    };
    const result = await helper.runDiagnostic({ fetchImpl: remote as typeof fetch, env: {}, keyResolver: jwks, freshLogin,
      openBrowser: async url => { if (!browserAvailable) return false; await authorizeLocally(url); return true; },
      onAuthorizationUrl: async url => { output(url); await authorizeLocally(url); } });
    expect(remote.mock.calls.filter(([url]) => String(url) !== pilot.resourceUri)).toHaveLength(3);
    const methods = remote.mock.calls.filter(([url, options]) => String(url) === pilot.resourceUri && options?.method === "POST")
      .map(([, options]) => JSON.parse(options!.body as string).method);
    expect(methods).toEqual(approved ? ["initialize", "notifications/initialized", "tools/list"] : []);
    expect(output).toHaveBeenCalledTimes(browserAvailable ? 0 : 1);
    expect(JSON.stringify(output.mock.calls)).not.toContain(token);
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/code_verifier|synthetic-code|never-output/);
    expect(result).toMatchObject(approved ? { resourceTokenVerified: true, approvedIdMatchPaths: ["/sub"],
      mcpInitializeSucceeded: true, toolsListSucceeded: true, toolCount: 1, toolNames: ["cw_test_connection"] }
      : { resourceTokenVerified: true, approvedIdMatchPaths: [] });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});

describe("SDK authenticated discovery diagnostics", () => {
  const verified = { resourceTokenVerified: true, approvedIdMatchPaths: ["/sub"] };
  it.each([
    ["initialize", "initialize", false, 403],
    ["notifications/initialized", "initialized", true, 400],
    ["tools/list", "tools/list", true, 500],
  ] as [string, string, boolean, number][])("sanitizes failure at %s", async (method, stage, initialized, status) => {
    const token = await sign();
    const remote = vi.fn(async (_input: string | URL | Request, options?: RequestInit) => sdkResponse(options, method, status));
    const result = await helper.discoverMcp(token, verified, { fetchImpl: remote as typeof fetch });
    expect(result).toMatchObject({ ...verified, mcpInitializeSucceeded: initialized,
      toolsListSucceeded: false, failureStage: stage, httpStatus: status });
    const output = vi.fn();
    expect(await helper.main(async () => ({ ...result, rawBody: "sensitive-response", token }), output)).toBe(3);
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/sensitive|SECRET|rawBody/);
    expect(JSON.stringify(output.mock.calls)).not.toContain(token);
  });
  it("reports sanitized network failure without inventing an HTTP status", async () => {
    const token = await sign();
    const result = await helper.discoverMcp(token, verified, { fetchImpl: async () => { throw new Error(token); } });
    expect(result).toMatchObject({ mcpInitializeSucceeded: false, failureStage: "initialize" });
    expect(result.httpStatus).toBeUndefined(); expect(JSON.stringify(result)).not.toContain(token);
  });
  it("rejects unsafe tool names instead of printing token-shaped metadata", async () => {
    const token = await sign();
    const result = await helper.discoverMcp(token, verified, { fetchImpl: async (_input, options) => {
      const message = options?.method === "POST" ? JSON.parse(options.body as string) : undefined;
      if (message?.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: message.id,
        result: { tools: [{ name: token, inputSchema: { type: "object" } }] } });
      return sdkResponse(options);
    } });
    expect(result).toMatchObject({ toolsListSucceeded: false, failureStage: "tools/list", httpStatus: 200 });
    expect(JSON.stringify(result)).not.toContain(token);
  });
  it("follows tools/list pagination using SDK requests", async () => {
    let calls = 0;
    const result = await helper.discoverMcp(await sign(), verified, { fetchImpl: async (_input, options) => {
      const message = options?.method === "POST" ? JSON.parse(options.body as string) : undefined;
      if (message?.method === "tools/list") {
        calls++;
        if (calls === 2) expect(message.params.cursor).toBe("synthetic-next");
        return Response.json({ jsonrpc: "2.0", id: message.id, result: {
          tools: [{ name: calls === 1 ? "cw_test_connection" : "cw_get_company", inputSchema: { type: "object" } }],
          ...(calls === 1 ? { nextCursor: "synthetic-next" } : {}) } });
      }
      return sdkResponse(options);
    } });
    expect(result.toolNames).toEqual(["cw_test_connection", "cw_get_company"]);
    expect(result.toolCount).toBe(2); expect(result.toolsListSucceeded).toBe(true);
  });
  it("does not log server-provided output-schema format text", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await helper.discoverMcp(await sign(), verified, { fetchImpl: async (_input, options) => {
        const message = options?.method === "POST" ? JSON.parse(options.body as string) : undefined;
        if (message?.method === "tools/list") return Response.json({ jsonrpc: "2.0", id: message.id, result: { tools: [{
          name: "cw_test_connection", inputSchema: { type: "object" },
          outputSchema: { type: "object", properties: { value: { type: "string", format: "sensitive-format-token" } } },
        }] } });
        return sdkResponse(options);
      } });
      expect(result.toolsListSucceeded).toBe(true);
      expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); error.mockRestore(); }
  });
  it("completes SDK discovery against the actual local Stage A handler without CW credentials", async () => {
    const provider = vi.fn(async () => null);
    const config = { ...pilot, approvedUserClaim: "/sub" };
    const handler = createHttpHandler({ authConfig: config,
      authenticate: createDescopeMcpAuthenticator(config, jwks), configProvider: provider });
    const server = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const local = `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
    try {
      const result = await helper.discoverMcp(await sign(), verified, { fetchImpl: async (_input, options) => fetch(local, options) });
      expect(result).toMatchObject({ mcpInitializeSucceeded: true, toolsListSucceeded: true,
        toolCount: 1, toolNames: ["cw_test_connection"] });
      expect(result.protocolVersion).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(provider).toHaveBeenCalled();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
