// LOCAL ONLY: one direct GET using the production loader/client; no MCP or writes.
/* global process, URL, Headers, Response, AbortSignal, Buffer */
import { pathToFileURL } from "node:url";
import { CwManageClient } from "../dist/api-client.js";
import { createConnectWiseConfigLoader } from "../dist/config-loader.js";

export function parseDiagnosticArguments(args) {
  const seen = new Set();
  const options = { pilot: false, deep: false, diagnosticTarget: "system-info" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const key = arg === "--companies" ? "--endpoint" : arg;
    if (seen.has(key)) throw new Error();
    seen.add(key);
    if (arg === "--pilot") options.pilot = true;
    else if (arg === "--deep") options.deep = true;
    else if (arg === "--without-client-id") options.withoutClientId = true;
    else if (arg === "--companies") options.diagnosticTarget = "companies"; // Existing local shorthand.
    else if (arg === "--client-id") {
      const value = args[++index];
      if (typeof value !== "string" || value.startsWith("--") || /[\r\n]/.test(value) ||
          !/^[\x21-\x7e]+$/.test(value.trim())) throw new Error();
      options.clientId = value.trim();
    }
    else if (arg === "--endpoint") {
      const target = args[++index];
      if (!["system-info", "companies"].includes(target)) throw new Error();
      options.diagnosticTarget = target;
    } else throw new Error();
  }
  if (options.withoutClientId && options.clientId !== undefined) throw new Error();
  return options;
}

/** Explicit local pilot shortcut: only known nonsecret inputs; no Azure writes. */
export function diagnosticEnvironment(args, env = process.env) {
  const options = parseDiagnosticArguments(args);
  const settings = options.pilot ? { ...env, CW_MANAGE_URL: "https://connect.connections.com",
    CW_MANAGE_COMPANY_ID: "connections", CW_KEY_VAULT_URI: "https://cw-mcp-kv.vault.azure.net" } : env;
  // Only an explicit historical baseline removes the configured Client ID.
  if (options.withoutClientId) return { ...settings, CW_MANAGE_CLIENT_ID: undefined };
  // Explicit local override otherwise wins over the configured operator ID.
  // Pass it through the existing loader/client, never print or persist it.
  return options.clientId === undefined ? settings : { ...settings, CW_MANAGE_CLIENT_ID: options.clientId };
}

function keyShape(prefix, value) {
  // Keys are inspected in memory only; values/lengths/hashes never reach output.
  return { [`${prefix}HasLeadingWhitespace`]: /^\s/.test(value),
    [`${prefix}HasTrailingWhitespace`]: /\s$/.test(value),
    [`${prefix}ContainsCrLf`]: /[\r\n]/.test(value),
    [`trimmingWouldChange${prefix[0].toUpperCase() + prefix.slice(1)}`]: value.trim() !== value,
    [`${prefix}HasQuoteAtBoundary`]: /^["']|["']$/.test(value),
    [`${prefix}LooksUrlEncoded`]: /%[0-9a-f]{2}/i.test(value) };
}

function headerShape(headers, config, url, options) {
  const authorization = headers.get("Authorization") || "";
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
  const decoded = match ? Buffer.from(match[1], "base64").toString("utf8") : undefined;
  const expected = `${config.companyId}+${config.publicKey}:${config.privateKey}`;
  const accept = headers.get("Accept");
  return {
    authorizationSchemeBasic: /^Basic /.test(authorization),
    authorizationPrefixDuplicated: /^Basic Basic /i.test(authorization),
    authorizationBase64Canonical: !!match && Buffer.from(match[1], "base64").toString("base64") === match[1],
    authorizationPayloadMatchesProduction: decoded === expected,
    authorizationPayloadUsesLiteralPlusSeparator: !!decoded?.startsWith(`${config.companyId}+`),
    authorizationPayloadColonPlacementCorrect: decoded === expected,
    acceptCategory: accept === "application/json" ? "application/json" :
      accept?.startsWith("application/vnd.connectwise.com+json") ? "connectwise_vendor_json" : "other_or_absent",
    contentTypePresent: headers.has("Content-Type"),
    contentTypeCategory: headers.get("Content-Type") === "application/json" ? "application/json" : "other_or_absent",
    userAgentExplicitlySet: headers.has("User-Agent"),
    unexpectedCustomHeadersPresent: [...headers.keys()].some(name =>
      !["authorization", "clientid", "accept", "content-type"].includes(name)),
    queryParametersPresent: !!url.search,
    duplicatePathSlashes: url.pathname.includes("//"),
    redirectsDisabled: options.redirect === "error",
    hostMatchesConfigured: url.hostname === new URL(config.baseUrl).hostname,
  };
}

const proxyHeaders = ["x-azure-ref", "x-azure-fdid", "x-ms-request-id", "x-ms-error-code",
  "x-arr-log-id", "x-arr-ssl", "x-powered-by", "via", "x-cache", "x-served-by",
  "cf-ray", "cf-cache-status", "x-envoy-upstream-service-time", "x-amz-cf-id", "x-amz-cf-pop"];
const schemes = new Map(["Basic", "Digest", "Bearer", "Negotiate", "NTLM", "DPoP"].map(name => [name.toLowerCase(), name]));

function challengeSchemes(value) {
  if (!value || value.length > 16384) return [];
  const parts = [];
  let start = 0, quoted = false, escaped = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === "\\") { escaped = true; continue; }
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) { parts.push(value.slice(start, index)); start = index + 1; }
  }
  if (quoted) return []; // Malformed quotes cannot establish challenge boundaries safely.
  parts.push(value.slice(start));
  return [...new Set(parts.flatMap(part => {
    const match = /^\s*([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.*))?\s*$/.exec(part);
    if (!match || match[2]?.trimStart().startsWith("=")) return [];
    const name = schemes.get(match[1].toLowerCase());
    return name ? [name] : [];
  }))];
}

function mediaCategory(value) {
  if (!value) return "absent";
  const type = value.split(";", 1)[0].trim().toLowerCase();
  const known = ["application/json", "application/vnd.connectwise.com+json", "text/html",
    "text/plain", "application/xml", "text/xml", "application/octet-stream"];
  if (known.includes(type)) return known.find(item => item === type);
  return /^application\/[a-z0-9.+-]+\+json$/.test(type) ? "application/*+json" : "other";
}

function serverCategory(value) {
  if (!value) return "absent";
  // Return fixed literals only, including a small known version allowlist.
  const versions = ["Microsoft-IIS/10.0", "Microsoft-IIS/8.5", "Microsoft-IIS/8.0", "Microsoft-IIS/7.5", "Microsoft-HTTPAPI/2.0"];
  const version = versions.find(item => item.toLowerCase() === value.trim().toLowerCase());
  if (version) return version;
  for (const family of ["Microsoft-IIS", "Microsoft-HTTPAPI", "nginx", "Apache", "envoy", "cloudflare", "Caddy", "awselb"]) {
    if (new RegExp(`^${family}(?:/|\\s|$)`, "i").test(value.trim())) return family;
  }
  return "other";
}

/** Only explicit header names are read; every emitted string is a fixed literal.
 * Challenge realms/parameters, arbitrary server suffixes, cookies and bodies
 * cannot be copied into the result. Body media type is declared, not sniffed.
 */
export function safeResponseMetadata(response) {
  const headers = response.headers;
  const get = name => typeof headers?.get === "function" ? headers.get(name) : null;
  const has = name => typeof headers?.has === "function" && headers.has(name);
  const category = mediaCategory(get("Content-Type"));
  return { responseContentType: category, responseBodyMediaType: category,
    serverHeader: serverCategory(get("Server")),
    wwwAuthenticateSchemes: challengeSchemes(get("WWW-Authenticate")),
    locationHeaderPresent: has("Location"),
    responseWasRedirect: response.redirected === true || [301, 302, 303, 307, 308].includes(response.status),
    proxyHeaderNames: proxyHeaders.filter(name => has(name)) };
}

/** Observe the real client request in this standalone process only. Never serialize
 * config, headers, errors or response data. Restore fetch even on early failure.
 * Dependency injection is for offline tests, not an alternative authentication path.
 */
export async function diagnoseCwAuth({ env = process.env, deep = false, diagnosticTarget = "system-info",
  loadConfig = createConnectWiseConfigLoader,
  fetchImpl = globalThis.fetch } = {}) {
  if (!["system-info", "companies"].includes(diagnosticTarget)) {
    return { requestSent: false, failureStage: "configuration", reason: "invalid_diagnostic_target" };
  }
  const companies = diagnosticTarget === "companies";
  // Explicit alternative, never an automatic fallback or a second request.
  const endpoint = companies ? "/company/companies" : "/system/info";
  const expectedPath = `/v4_6_release/apis/3.0${endpoint}`;
  const result = { requestSent: false, diagnosticTarget, method: "GET", path: endpoint,
    baseUrlParsed: false, httpsUsed: false, companyIdPresent: false,
    publicKeyPresent: false, privateKeyPresent: false, authorizationHeaderPresent: false,
    clientIdHeaderPresent: false, tlsVerification: true };
  if (companies) result.pageSize = 1;
  if (env.CW_MANAGE_REJECT_UNAUTHORIZED === "false" || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    return { ...result, tlsVerification: false, failureStage: "configuration", reason: "tls_verification_disabled" };
  }
  result.companyIdPresent = typeof env.CW_MANAGE_COMPANY_ID === "string" && !!env.CW_MANAGE_COMPANY_ID.trim();
  if (!env.CW_MANAGE_URL || !env.CW_KEY_VAULT_URI || !result.companyIdPresent) {
    return { ...result, failureStage: "configuration", reason: "missing_runtime_inputs" };
  }
  try {
    const base = new URL(env.CW_MANAGE_URL);
    result.baseUrlParsed = true;
    result.httpsUsed = base.protocol === "https:";
    if (!result.httpsUsed || base.username || base.password || base.search || base.hash) throw new Error();
  } catch { return { ...result, failureStage: "configuration", reason: "invalid_connectwise_url" }; }
  try {
    const vault = new URL(env.CW_KEY_VAULT_URI);
    if (vault.protocol !== "https:" || vault.username || vault.password || vault.port || vault.search || vault.hash ||
        vault.pathname !== "/" || !/^[a-z][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(vault.hostname)) throw new Error();
  } catch { return { ...result, failureStage: "configuration", reason: "invalid_key_vault_uri" }; }
  let config;
  try {
    // A local-only snapshot selects the existing DefaultAzureCredential branch.
    // Do not modify process.env or accept environment API keys as a fallback.
    config = await loadConfig({ env: { ...env, NODE_ENV: "development", CW_CONFIG_SOURCE: "key-vault" } })();
    if (!config) return { ...result, failureStage: "configuration", reason: "missing_or_placeholder_secrets" };
    const base = new URL(config.baseUrl);
    result.baseUrlParsed = true;
    result.httpsUsed = base.protocol === "https:";
    result.companyIdPresent = typeof config.companyId === "string" && !!config.companyId.trim();
    result.publicKeyPresent = typeof config.publicKey === "string" && !!config.publicKey.trim();
    result.privateKeyPresent = typeof config.privateKey === "string" && !!config.privateKey.trim();
    if (deep && typeof config.publicKey === "string" && typeof config.privateKey === "string") {
      Object.assign(result, keyShape("publicKey", config.publicKey), keyShape("privateKey", config.privateKey), {
        companyIdHasLeadingWhitespace: /^\s/.test(config.companyId),
        companyIdHasTrailingWhitespace: /\s$/.test(config.companyId),
        companyIdContainsCrLf: /[\r\n]/.test(config.companyId),
      });
    }
    if (!result.httpsUsed || base.username || base.password || base.search || base.hash ||
        !result.companyIdPresent || !result.publicKeyPresent || !result.privateKeyPresent ||
        config.rejectUnauthorized === false) return { ...result, failureStage: "configuration" };
    result.host = base.hostname;
  } catch (error) {
    return { ...result, failureStage: "configuration", reason: error && typeof error === "object" &&
      error.code === "cw-config-unavailable" ? "key_vault_access_failed" : "configuration_load_failed" };
  }

  const previousFetch = globalThis.fetch;
  let observed = false;
  let shapeRejected = false;
  try {
    const client = new CwManageClient(config);
    globalThis.fetch = async (input, options) => {
      // Guard against additional requests, redirects or any unapproved query/path.
      if (observed) { shapeRejected = true; throw new Error(); }
      observed = true;
      const url = new URL(input);
      const headers = new Headers(options?.headers);
      result.authorizationHeaderPresent = !!headers.get("Authorization");
      result.authorizationSchemeBasic = /^Basic /.test(headers.get("Authorization") || "");
      result.clientIdHeaderPresent = headers.has("clientId");
      result.queryParametersPresent = !!url.search;
      result.unexpectedExtraPathSegments = url.pathname !== expectedPath;
      if (deep) Object.assign(result, headerShape(headers, config, url, options));
      const expectedClientId = config.clientId?.trim() || undefined;
      const queryAllowed = companies
        ? url.searchParams.size === 1 && url.searchParams.get("pageSize") === "1"
        : !url.search;
      if (deep) result.queryParametersExpected = queryAllowed;
      if (options?.method !== "GET" || options.redirect !== "error" || options.body !== undefined ||
          options.dispatcher !== undefined || url.protocol !== "https:" || url.hostname !== result.host ||
          !queryAllowed || url.hash || url.username || url.password || result.unexpectedExtraPathSegments ||
          !result.authorizationHeaderPresent || headers.get("clientId") !== (expectedClientId ?? null)) {
        shapeRejected = true;
        throw new Error();
      }
      result.finalRequestPath = expectedPath;
      result.requestSent = true;
      const response = await fetchImpl(input, { ...options, signal: AbortSignal.timeout(15000) });
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) throw new Error();
      result.httpStatus = response.status;
      if (deep) Object.assign(result, safeResponseMetadata(response));
      // Never read/parse the body. Cancel the unused stream.
      try { await response.body?.cancel(); } catch { /* Nothing from the body reaches output. */ }
      // The client receives an empty success response so it never parses original data.
      return new Response(null, { status: 204 });
    };
    await client.get(endpoint, companies ? { pageSize: 1 } : undefined);
    return result;
  } catch {
    return { ...result, connectionSucceeded: false,
      failureStage: shapeRejected ? "request_shape" : result.requestSent ? "network" : "configuration" };
  } finally { globalThis.fetch = previousFetch; }
}

export async function main() {
  let result;
  try {
    const args = process.argv.slice(2);
    const options = parseDiagnosticArguments(args);
    result = await diagnoseCwAuth({ env: diagnosticEnvironment(args), deep: options.deep,
      diagnosticTarget: options.diagnosticTarget });
  }
  catch { result = { requestSent: false, failureStage: "configuration", reason: "invalid_options_or_setup" }; }
  // Result is constructed exclusively from fixed labels, booleans, host/path and status.
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.httpStatus >= 200 && result.httpStatus < 300 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
