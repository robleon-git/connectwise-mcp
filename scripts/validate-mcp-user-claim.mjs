// Local diagnostic only. Never imports/starts the MCP service or changes its policy.
/* global process, Buffer, fetch, URL, URLSearchParams, AbortSignal, AbortController, setTimeout, clearTimeout */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv-provider.js";
import Ajv from "ajv";
import addFormats from "ajv-formats";

// Public identifiers from the validated pilot configuration; never session-preview values.
export const PILOT = Object.freeze({
  issuer: "https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au",
  jwksUri: "https://api.descope.com/P3KF3ouEKxhaIJBilPItOXL8i76g/.well-known/jwks.json",
  resourceUri: "https://api.monotorr.com/mcp",
  requiredScope: "connectwise.read",
  approvedUserId: "U3KFfMleU85iOGGJcBQTzguQuVYZ",
});

function failure() { return new Error("Local OAuth diagnostic failed; details suppressed."); }

// Optional existing NONSECRET environment settings may agree with the pilot;
// reject conflicting targets rather than sending a token to another resource.
export function checkPilotEnvironment(env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw failure();
  const fields = { DESCOPE_MCP_ISSUER: "issuer", DESCOPE_MCP_JWKS_URI: "jwksUri",
    MCP_RESOURCE_URI: "resourceUri", MCP_REQUIRED_SCOPE: "requiredScope", MCP_APPROVED_USER_ID: "approvedUserId" };
  for (const [name, field] of Object.entries(fields)) {
    if (env[name] && env[name] !== PILOT[field]) throw failure();
  }
  // MCP_APPROVED_USER_CLAIM is intentionally never read or modified.
}

export function findApprovedPaths(payload) {
  const matches = [];
  let visited = 0;
  function walk(value, parts, depth) {
    if (++visited > 10000 || depth > 64) throw failure();
    if (value === PILOT.approvedUserId) {
      // A claim name itself could contain arbitrary data. Do not emit token-like
      // or free-text segments; fail instead of printing them or guessing a path.
      if (!parts.every(key => /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(key) || /^\d{1,10}$/.test(key))) throw failure();
      matches.push("/" + parts.join("/"));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, [...parts, key], depth + 1);
    }
  }
  walk(payload, [], 0);
  return matches.sort();
}

export async function verifyTokenAndFindPaths(token, keyResolver) {
  try {
    if (typeof token !== "string" || token.length > 16384 ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw failure();
    const jwks = keyResolver ?? createRemoteJWKSet(new URL(PILOT.jwksUri), {
      timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
    });
    // Same access-token contract as src/auth/descope-mcp.ts, without granting API access.
    const { payload } = await jwtVerify(token, jwks, { algorithms: ["RS256"],
      issuer: PILOT.issuer, audience: PILOT.resourceUri,
      requiredClaims: ["iss", "aud", "exp", "sub"] });
    if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes(PILOT.requiredScope)) throw failure();
    return { resourceTokenVerified: true, approvedIdMatchPaths: findApprovedPaths(payload) };
  } catch { throw failure(); }
}

async function jsonRequest(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, { ...options, redirect: "error",
    signal: options.signal ?? AbortSignal.timeout(20000), headers: { Accept: "application/json", ...options.headers } });
  if (!response.ok) throw failure();
  let body = "";
  for await (const chunk of response.body) {
    body += Buffer.from(chunk).toString("utf8");
    if (body.length > 262144) throw failure();
  }
  return JSON.parse(body);
}

export function validateDiscovery(metadata) {
  const oauthBase = PILOT.issuer.replace("/v1/apps/agentic/", "/oauth2/v1/apps/agentic/");
  const registration = PILOT.issuer.replace("/v1/apps/agentic/", "/v1/mgmt/mcp/client/") + "/register";
  if (metadata.issuer !== PILOT.issuer || metadata.jwks_uri !== PILOT.jwksUri ||
      metadata.authorization_endpoint !== oauthBase + "/authorize" ||
      metadata.token_endpoint !== oauthBase + "/token" || metadata.registration_endpoint !== registration ||
      !metadata.response_types_supported?.includes("code") ||
      !metadata.code_challenge_methods_supported?.includes("S256") ||
      !metadata.scopes_supported?.includes(PILOT.requiredScope) ||
      !metadata.scopes_supported?.includes("offline_access") ||
      !metadata.token_endpoint_auth_methods_supported?.includes("none")) throw failure();
  return metadata;
}

function equalState(received, expected) {
  if (typeof received !== "string") return false;
  const left = Buffer.from(received), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function createLoopbackCallback(state, metadata, timeoutMs = 300000) {
  const callbackPath = "/callback/" + randomBytes(24).toString("base64url");
  let resolveCode, rejectCode, done = false;
  const code = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // A timeout can occur during discovery/browser startup; avoid unhandled rejection.
  void code.catch(() => {});
  const finish = (error, value) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (error) rejectCode(failure()); else resolveCode(value);
  };
  let redirectUri;
  const server = createServer({ maxHeaderSize: 16384 }, (req, res) => {
    const reply = status => {
      res.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'", Connection: "close" });
      res.end(status === 200 ? "OAuth callback received. Close this tab and return to the terminal." : "Callback rejected.");
    };
    try {
      if (done || req.method !== "GET" || req.headers.host !== new URL(redirectUri).host || req.url.length > 16384) { reply(400); return; }
      const url = new URL(req.url, redirectUri);
      if (url.origin !== new URL(redirectUri).origin || url.pathname !== callbackPath) { reply(404); return; }
      const params = url.searchParams;
      if (params.getAll("state").length !== 1 || !equalState(params.get("state"), state) ||
          params.getAll("iss").length > 1 || (params.has("iss") && params.get("iss") !== PILOT.issuer) ||
          (metadata.authorization_response_iss_parameter_supported === true && !params.has("iss"))) { reply(400); return; }
      if (params.has("error")) { reply(400); finish(true); return; }
      if (params.getAll("code").length !== 1 || !params.get("code")) { reply(400); return; }
      reply(200); finish(false, params.get("code"));
    } catch { reply(400); }
  });
  const timer = setTimeout(() => finish(true), timeoutMs);
  server.on("error", () => finish(true));
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    redirectUri = `http://127.0.0.1:${server.address().port}${callbackPath}`;
  } catch { clearTimeout(timer); server.close(); throw failure(); }
  return { redirectUri, code, cancel: () => finish(true), close: async () => {
    finish(true);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  } };
}

export async function openDefaultBrowser(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : undefined;
  if (!command) return false;
  return new Promise(resolve => {
    const child = spawn(command, [url], { stdio: "ignore", shell: false });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", code => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Standard SDK handshake only: no tool execution, token output or auth fallback. */
export async function discoverMcp(token, verified, { fetchImpl = fetch, signal } = {}) {
  const facts = { ...verified, mcpInitializeSucceeded: false, toolsListSucceeded: false };
  let stage = "initialize";
  const statuses = new Map();
  const transport = new StreamableHTTPClientTransport(new URL(PILOT.resourceUri), {
    requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: "error" },
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    fetch: async (input, options) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.href !== PILOT.resourceUri) throw failure();
      const message = options?.method === "POST" && typeof options.body === "string" ? JSON.parse(options.body) : undefined;
      const requestStage = message?.method === "notifications/initialized" ? "initialized" :
        message?.method === "tools/list" ? "tools/list" : message?.method === "initialize" ? "initialize" : undefined;
      if (requestStage) stage = requestStage;
      const response = await fetchImpl(input, { ...options, redirect: "error",
        signal: AbortSignal.any([options?.signal, signal, AbortSignal.timeout(20000)].filter(Boolean)) });
      // Optional GET SSE (405 for this server) must not overwrite POST stage facts.
      if (requestStage) statuses.set(requestStage, response.status);
      return response;
    },
  });
  // Same SDK validator configuration, with logging disabled: unknown schema formats
  // can otherwise cause AJV to print server-provided text. Both packages are already
  // installed SDK dependencies; no package or application dependency is changed.
  const ajv = new Ajv({ strict: false, validateFormats: true, validateSchema: false, allErrors: true, logger: false });
  addFormats(ajv);
  const client = new Client({ name: "connectwise-mcp-local-discovery-diagnostic", version: "1.0.0" }, {
    capabilities: {}, jsonSchemaValidator: new AjvJsonSchemaValidator(ajv),
  });
  // SDK error messages can contain HTTP bodies; observe no raw error objects.
  client.onerror = () => {};
  try {
    // SDK negotiates protocol and sends notifications/initialized itself.
    await client.connect(transport, { timeout: 30000, ...(signal ? { signal } : {}) });
    facts.mcpInitializeSucceeded = true;
    facts.protocolVersion = transport.protocolVersion;
    stage = "tools/list";
    const names = [];
    let cursor;
    let pages = 0;
    do {
      if (++pages > 32) throw failure();
      const listing = await client.listTools(cursor ? { cursor } : undefined, { timeout: 30000, ...(signal ? { signal } : {}) });
      for (const tool of listing.tools) {
        // Only bounded CW identifiers; never descriptions, schemas or other fields.
        if (!/^cw_[a-z0-9_]{1,76}$/.test(tool.name) || names.length >= 2000) throw failure();
        names.push(tool.name);
      }
      cursor = listing.nextCursor;
    } while (cursor);
    facts.toolsListSucceeded = true;
    facts.toolCount = names.length;
    facts.toolNames = names;
  } catch {
    facts.mcpInitializeSucceeded = SUPPORTED_PROTOCOL_VERSIONS.includes(transport.protocolVersion);
    if (facts.mcpInitializeSucceeded) facts.protocolVersion = transport.protocolVersion;
    facts.failureStage = stage;
    const status = statuses.get(stage);
    if (Number.isInteger(status) && status >= 100 && status <= 599) facts.httpStatus = status;
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
  return facts;
}

export function freshLoginParameters(metadata) {
  // Standard OIDC request, never a Descope-specific flow/session override. If the
  // AS explicitly advertises prompts without login, stop rather than downgrade.
  if (metadata.prompt_values_supported !== undefined && metadata.prompt_values_supported !== null &&
      (!Array.isArray(metadata.prompt_values_supported) || !metadata.prompt_values_supported.includes("login"))) throw failure();
  return { prompt: "login" };
}

export async function runDiagnostic({ fetchImpl = fetch, openBrowser = openDefaultBrowser,
  onAuthorizationUrl = url => process.stderr.write(`Open this OAuth authorization URL in your browser:\n${url}\n`),
  keyResolver, env = process.env, callbackTimeoutMs = 300000, freshLogin = false } = {}) {
  checkPilotEnvironment(env);
  const metadata = validateDiscovery(await jsonRequest(fetchImpl, PILOT.issuer + "/.well-known/openid-configuration"));
  const interaction = freshLogin ? freshLoginParameters(metadata) : {};
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = await createLoopbackCallback(state, metadata, callbackTimeoutMs);
  const abort = new AbortController();
  const cancel = () => { callback.cancel(); abort.abort(); };
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try {
    // A new public, code-only loopback client. No management key/client secret.
    // This is the only broker mutation and occurs only when the operator runs the helper.
    const client = await jsonRequest(fetchImpl, metadata.registration_endpoint, {
      method: "POST", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        client_name: "ConnectWise MCP local claim diagnostic", redirect_uris: [callback.redirectUri],
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        token_endpoint_auth_method: "none", scope: "connectwise.read offline_access",
      }),
    });
    if (typeof client.client_id !== "string" || !client.client_id || client.client_id.length > 2048 ||
        client.token_endpoint_auth_method !== "none" ||
        !Array.isArray(client.redirect_uris) || client.redirect_uris.length !== 1 ||
        client.redirect_uris[0] !== callback.redirectUri) throw failure();
    const authorize = new URL(metadata.authorization_endpoint);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: client.client_id,
      redirect_uri: callback.redirectUri, state, code_challenge: challenge, code_challenge_method: "S256",
      resource: PILOT.resourceUri, scope: "connectwise.read offline_access", ...interaction }).toString();
    if (!await openBrowser(authorize.href).catch(() => false)) await onAuthorizationUrl(authorize.href);
    const code = await callback.code;
    const tokens = await jsonRequest(fetchImpl, metadata.token_endpoint, {
      method: "POST", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callback.redirectUri,
        client_id: client.client_id, code_verifier: verifier, resource: PILOT.resourceUri }),
    });
    if (typeof tokens.token_type !== "string" || tokens.token_type.toLowerCase() !== "bearer") throw failure();
    // Only the access token enters the SDK, in process memory. No token fields escape.
    const verified = await verifyTokenAndFindPaths(tokens.access_token, keyResolver);
    if (!verified.approvedIdMatchPaths.length) return verified;
    return await discoverMcp(tokens.access_token, verified, { fetchImpl, signal: abort.signal });
  } catch { throw failure(); }
  finally {
    process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
    await callback.close();
  }
}

export async function main(run = runDiagnostic, output = value => process.stdout.write(value + "\n")) {
  try {
    const result = await run();
    if (result.resourceTokenVerified !== true || !Array.isArray(result.approvedIdMatchPaths) ||
        !result.approvedIdMatchPaths.every(path => typeof path === "string" &&
          /^\/(?:[A-Za-z_][A-Za-z0-9_-]{0,63}|\d{1,10})(?:\/(?:[A-Za-z_][A-Za-z0-9_-]{0,63}|\d{1,10}))*$/.test(path))) throw failure();
    const safe = { resourceTokenVerified: true, approvedIdMatchPaths: result.approvedIdMatchPaths };
    if (typeof result.mcpInitializeSucceeded === "boolean") safe.mcpInitializeSucceeded = result.mcpInitializeSucceeded;
    if (typeof result.toolsListSucceeded === "boolean") safe.toolsListSucceeded = result.toolsListSucceeded;
    if (SUPPORTED_PROTOCOL_VERSIONS.includes(result.protocolVersion)) safe.protocolVersion = result.protocolVersion;
    if (["initialize", "initialized", "tools/list"].includes(result.failureStage)) safe.failureStage = result.failureStage;
    if (Number.isInteger(result.httpStatus) && result.httpStatus >= 100 && result.httpStatus <= 599) safe.httpStatus = result.httpStatus;
    if (result.toolsListSucceeded === true) {
      if (!Array.isArray(result.toolNames) || result.toolNames.length > 2000 ||
          !result.toolNames.every(name => typeof name === "string" && /^cw_[a-z0-9_]{1,76}$/.test(name))) throw failure();
      safe.toolCount = result.toolNames.length;
      safe.toolNames = result.toolNames;
    }
    output(JSON.stringify(safe));
    if (!result.approvedIdMatchPaths.length) return 2;
    return result.failureStage ? 3 : 0;
  } catch {
    output(JSON.stringify({ resourceTokenVerified: false, approvedIdMatchPaths: [] }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // No token/secret/target command-line arguments are supported.
  process.exitCode = await main(process.argv.length === 2 ? runDiagnostic : async () => { throw failure(); });
}
