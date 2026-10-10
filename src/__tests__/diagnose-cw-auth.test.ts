import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectWiseConfigLoader } from "../config-loader.js";
import type { Environment } from "../config.js";
// @ts-expect-error Local operator script has no TypeScript declarations.
import { diagnoseCwAuth, diagnosticEnvironment, safeResponseMetadata, parseDiagnosticArguments } from "../../scripts/diagnose-cw-auth.mjs";
import { ConfigurationError } from "../diagnostics.js";

const keys = { publicKey: "synthetic-public-canary", privateKey: "synthetic-private-canary" };
const env = { CW_KEY_VAULT_URI: "https://cw-pilot.vault.azure.net", CW_MANAGE_URL: "https://cw.example",
  CW_MANAGE_COMPANY_ID: "synthetic-company", NODE_ENV: "production" };
const config = { baseUrl: env.CW_MANAGE_URL, companyId: env.CW_MANAGE_COMPANY_ID, ...keys, rejectUnauthorized: true };
const authorization = `Basic ${Buffer.from(`${config.companyId}+${keys.publicKey}:${keys.privateKey}`).toString("base64")}`;
const loadConfig = vi.fn(() => async () => config);
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("local direct ConnectWise auth diagnostic", () => {
  it("uses known nonsecret pilot settings without changing the environment or clearing configured Client ID", () => {
    const supplied = { ...env, CW_MANAGE_CLIENT_ID: "operator-id" };
    expect(diagnosticEnvironment(["--pilot"], supplied)).toMatchObject({ CW_MANAGE_URL: "https://connect.connections.com",
      CW_MANAGE_COMPANY_ID: "connections", CW_KEY_VAULT_URI: "https://cw-mcp-kv.vault.azure.net", CW_MANAGE_CLIENT_ID: "operator-id" });
    expect(supplied.CW_MANAGE_CLIENT_ID).toBe("operator-id");
    expect(diagnosticEnvironment([], supplied)).toBe(supplied);
    expect(diagnosticEnvironment(["--deep"], supplied)).toBe(supplied);
    expect(diagnosticEnvironment(["--pilot", "--deep"], supplied).CW_MANAGE_CLIENT_ID).toBe("operator-id");
    expect(diagnosticEnvironment(["--pilot", "--deep", "--companies"], supplied).CW_MANAGE_CLIENT_ID).toBe("operator-id");
    expect(() => diagnosticEnvironment(["--unknown"], supplied)).toThrow();
    expect(() => diagnosticEnvironment(["--deep", "--deep"], supplied)).toThrow();
  });
  it("enforces a fresh production build for supported npm diagnostic/test entrypoints", () => {
    const { scripts } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(scripts["prediagnose:cw-auth"]).toBe("npm run build");
    expect(scripts["diagnose:cw-auth"]).toBe("node scripts/diagnose-cw-auth.mjs");
    expect(scripts.pretest).toBe("npm run build");
    expect(scripts["pretest:watch"]).toBe("npm run build");
    expect(scripts.lint).toContain("scripts/diagnose-cw-auth.mjs");
  });
  it.each([false, true])("preserves the configured ID by default and omits it only for explicit baseline (pilot=%s)", async pilot => {
    const clientId = "synthetic-configured-client-id-canary";
    const supplied = { ...env, CW_MANAGE_CLIENT_ID: clientId };
    const loader = (options: { env: Environment }) => createConnectWiseConfigLoader({ ...options,
      createSecretReader: async () => async name => name === "connectwise-public-key" ? keys.publicKey : keys.privateKey });
    for (const withoutClientId of [false, true]) {
      const args = [...(pilot ? ["--pilot"] : []), ...(withoutClientId ? ["--without-client-id"] : [])];
      const settings = diagnosticEnvironment(args, supplied);
      const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 200 }));
      const result = await diagnoseCwAuth({ env: settings, loadConfig: loader, fetchImpl, deep: true });
      expect(result).toMatchObject({ requestSent: true, clientIdHeaderPresent: !withoutClientId, httpStatus: 200 });
      expect(fetchImpl).toHaveBeenCalledOnce();
      const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
      expect(headers.get("clientId")).toBe(withoutClientId ? null : clientId);
      expect(headers.get("Authorization")).toBe(`Basic ${Buffer.from(`${settings.CW_MANAGE_COMPANY_ID}+${keys.publicKey}:${keys.privateKey}`).toString("base64")}`);
      expect(JSON.stringify(result)).not.toContain(clientId);
      expect(supplied.CW_MANAGE_CLIENT_ID).toBe(clientId);
    }
  });
  it("rejects contradictory or duplicate no-ID options regardless of order", () => {
    expect(() => parseDiagnosticArguments(["--without-client-id", "--client-id", "synthetic-id"])).toThrow();
    expect(() => parseDiagnosticArguments(["--client-id", "synthetic-id", "--without-client-id"])).toThrow();
    expect(() => parseDiagnosticArguments(["--without-client-id", "--without-client-id"])).toThrow();
  });
  it.each([false, true])("passes explicit --client-id through the actual loader/client, without output or mutation (pilot=%s)", async pilot => {
    const clientId = "synthetic-operator-client-id-canary";
    const args = [...(pilot ? ["--pilot"] : []), "--endpoint", "companies", "--client-id", clientId];
    const supplied = { ...env, CW_MANAGE_CLIENT_ID: "previous-operator-id" };
    const settings = diagnosticEnvironment(args, supplied);
    expect(settings.CW_MANAGE_CLIENT_ID).toBe(clientId);
    expect(supplied.CW_MANAGE_CLIENT_ID).toBe("previous-operator-id");
    const loader = (options: { env: Environment }) => createConnectWiseConfigLoader({ ...options,
      createSecretReader: async () => async name => name === "connectwise-public-key" ? keys.publicKey : keys.privateKey });
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 401 }));
    const result = await diagnoseCwAuth({ env: settings, loadConfig: loader, fetchImpl, deep: true,
      diagnosticTarget: parseDiagnosticArguments(args).diagnosticTarget });
    expect(result).toMatchObject({ requestSent: true, clientIdHeaderPresent: true, httpStatus: 401 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const headers = new Headers(fetchImpl.mock.calls[0][1].headers);
    expect(headers.get("clientId")).toBe(clientId);
    expect(headers.get("Authorization")).toBe(`Basic ${Buffer.from(`${settings.CW_MANAGE_COMPANY_ID}+${keys.publicKey}:${keys.privateKey}`).toString("base64")}`);
    expect(JSON.stringify([result, logs.mock.calls])).not.toContain(clientId);
    expect(diagnosticEnvironment(pilot ? ["--pilot"] : [], supplied).CW_MANAGE_CLIENT_ID)
      .toBe("previous-operator-id");
  });
  it.each([[], [""], ["   "], ["--endpoint"], ["unsafe\r\nvalue"]].map(values => ({ values })))("rejects absent/invalid Client ID arguments safely ($values)", ({ values }) => {
    expect(() => parseDiagnosticArguments(["--client-id", ...values])).toThrow();
  });
  it("rejects duplicate Client ID overrides and applies override regardless of flag order", () => {
    expect(() => parseDiagnosticArguments(["--client-id", "first", "--client-id", "second"])).toThrow();
    expect(diagnosticEnvironment(["--client-id", "synthetic-id", "--pilot"], env).CW_MANAGE_CLIENT_ID).toBe("synthetic-id");
  });
  it.each([
    [{ CW_MANAGE_URL: "[https://cw.example](https://cw.example)" }, "invalid_connectwise_url"],
    [{ CW_KEY_VAULT_URI: "[https://cw-pilot.vault.azure.net](https://cw-pilot.vault.azure.net)" }, "invalid_key_vault_uri"],
    [{ CW_KEY_VAULT_URI: undefined }, "missing_runtime_inputs"],
  ])("reports safe preflight reason without accessing Vault for %s", async (change, reason) => {
    const fetchImpl = vi.fn();
    const result = await diagnoseCwAuth({ env: { ...env, ...change }, loadConfig, fetchImpl });
    expect(result).toMatchObject({ requestSent: false, failureStage: "configuration", reason });
    expect(loadConfig).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("[");
  });
  it("distinguishes safe Vault access failure from absent secrets without printing errors", async () => {
    const fetchImpl = vi.fn();
    const failure = new ConfigurationError("cw-config-unavailable"); failure.message = keys.privateKey;
    const denied = await diagnoseCwAuth({ env, loadConfig: () => async () => { throw failure; }, fetchImpl });
    expect(denied).toMatchObject({ requestSent: false, baseUrlParsed: true, reason: "key_vault_access_failed" });
    const missing = await diagnoseCwAuth({ env, loadConfig: () => async () => null, fetchImpl });
    expect(missing.reason).toBe("missing_or_placeholder_secrets");
    expect(JSON.stringify([denied, missing])).not.toContain(keys.privateKey); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([200, 401, 403])("reports HTTP %s without response data, keys or Authorization", async status => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    const cancel = vi.fn(async () => {}), json = vi.fn(), text = vi.fn();
    const fetchImpl = vi.fn(async () => ({ status, body: { cancel }, json, text,
      headers: new Headers({ Authorization: authorization, "Set-Cookie": keys.privateKey }) }));
    const previous = globalThis.fetch;
    const result = await diagnoseCwAuth({ env, loadConfig, fetchImpl, deep: true });
    expect(result).toMatchObject({ requestSent: true, method: "GET", host: "cw.example", path: "/system/info",
      finalRequestPath: "/v4_6_release/apis/3.0/system/info", unexpectedExtraPathSegments: false,
      companyIdPresent: true, publicKeyPresent: true, privateKeyPresent: true,
      authorizationHeaderPresent: true, clientIdHeaderPresent: false, tlsVerification: true, httpStatus: status });
    expect(result).toMatchObject({ authorizationSchemeBasic: true, authorizationPrefixDuplicated: false,
      authorizationBase64Canonical: true, authorizationPayloadMatchesProduction: true,
      authorizationPayloadUsesLiteralPlusSeparator: true, authorizationPayloadColonPlacementCorrect: true,
      publicKeyHasLeadingWhitespace: false, publicKeyHasTrailingWhitespace: false, publicKeyContainsCrLf: false,
      privateKeyHasLeadingWhitespace: false, privateKeyHasTrailingWhitespace: false, privateKeyContainsCrLf: false,
      trimmingWouldChangePublicKey: false, trimmingWouldChangePrivateKey: false,
      acceptCategory: "application/json", contentTypePresent: true, contentTypeCategory: "application/json",
      userAgentExplicitlySet: false, unexpectedCustomHeadersPresent: false, queryParametersPresent: false,
      duplicatePathSlashes: false, redirectsDisabled: true, hostMatchesConfigured: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cw.example/v4_6_release/apis/3.0/system/info");
    expect(options).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(options.headers).get("Authorization")).toBe(authorization);
    const encoded = new Headers(options.headers).get("Authorization")!.slice("Basic ".length);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(decoded).toBe(`${config.companyId}+${keys.publicKey}:${keys.privateKey}`);
    expect(decoded).not.toContain("robapi");
    expect(decoded).not.toContain("Basic ");
    expect(new Headers(options.headers).has("clientId")).toBe(false);
    expect(json).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledOnce();
    const output = JSON.stringify([result, logs.mock.calls]);
    for (const secret of [keys.publicKey, keys.privateKey, authorization, config.companyId]) expect(output).not.toContain(secret);
    expect(globalThis.fetch).toBe(previous);
  });
  it.each([200, 401, 403, 404])("compares companies using exactly one read-only GET on HTTP %s", async status => {
    const response = new Response(JSON.stringify({ privateKey: keys.privateKey, customer: "sensitive-customer" }), {
      status, headers: { "Content-Type": "application/json" },
    });
    const text = vi.spyOn(response, "text"), json = vi.spyOn(response, "json");
    const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => response);
    const result = await diagnoseCwAuth({ env, loadConfig, fetchImpl, deep: true, diagnosticTarget: "companies" });
    expect(result).toMatchObject({ requestSent: true, diagnosticTarget: "companies", pageSize: 1, path: "/company/companies",
      finalRequestPath: "/v4_6_release/apis/3.0/company/companies", httpStatus: status,
      queryParametersPresent: true, queryParametersExpected: true,
      authorizationPayloadMatchesProduction: true, clientIdHeaderPresent: false });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [input, options] = fetchImpl.mock.calls[0];
    const url = new URL(input);
    expect(url.pathname).toBe("/v4_6_release/apis/3.0/company/companies");
    expect(input).toBe("https://cw.example/v4_6_release/apis/3.0/company/companies?pageSize=1");
    expect([...url.searchParams.entries()]).toEqual([["pageSize", "1"]]);
    expect(options).toMatchObject({ method: "GET", redirect: "error" });
    expect(new Headers(options.headers).get("Authorization")).toBe(authorization);
    expect(json).not.toHaveBeenCalled(); expect(text).not.toHaveBeenCalled();
    for (const secret of [keys.privateKey, keys.publicKey, authorization, "sensitive-customer"]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it("defaults to system-info and accepts only the two named targets", () => {
    expect(parseDiagnosticArguments(["--pilot", "--deep"])).toEqual({ pilot: true, deep: true, diagnosticTarget: "system-info" });
    expect(parseDiagnosticArguments(["--pilot", "--endpoint", "companies"])).toEqual({ pilot: true, deep: false, diagnosticTarget: "companies" });
    expect(parseDiagnosticArguments(["--endpoint", "system-info"]).diagnosticTarget).toBe("system-info");
    expect(parseDiagnosticArguments(["--companies"]).diagnosticTarget).toBe("companies");
    expect(() => parseDiagnosticArguments(["--companies", "--endpoint", "companies"])).toThrow();
  });
  it("includes the requested safe companies facts without requiring deep mode", async () => {
    const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response("sensitive-customer", { status: 200 }));
    const result = await diagnoseCwAuth({ env, loadConfig, fetchImpl, diagnosticTarget: "companies" });
    expect(result).toMatchObject({ requestSent: true, diagnosticTarget: "companies", method: "GET", host: "cw.example",
      finalRequestPath: "/v4_6_release/apis/3.0/company/companies", queryParametersPresent: true, pageSize: 1,
      authorizationHeaderPresent: true, authorizationSchemeBasic: true, clientIdHeaderPresent: false, httpStatus: 200 });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("sensitive-customer");
    expect(JSON.stringify(result)).not.toContain(authorization);
  });
  it.each(["https://secret.example", "/company/companies", "../system/info", "companies?pageSize=1000", "__proto__", "companies;command"])(
    "rejects endpoint/path injection without accessing Vault or sending a request (%s)", async target => {
      expect(() => parseDiagnosticArguments(["--endpoint", target])).toThrow();
      const fetchImpl = vi.fn();
      expect(await diagnoseCwAuth({ env, loadConfig, fetchImpl, diagnosticTarget: target })).toEqual({ requestSent: false,
        failureStage: "configuration", reason: "invalid_diagnostic_target" });
      expect(loadConfig).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    });
  it("rejects missing and duplicate endpoint arguments", () => {
    expect(() => parseDiagnosticArguments(["--endpoint"])).toThrow();
    expect(() => parseDiagnosticArguments(["--endpoint", "companies", "--endpoint", "system-info"])).toThrow();
  });
  it.each([
    [" leading", true, false, false, true, false, false],
    ["trailing ", false, true, false, true, false, false],
    ["\nsynthetic\r\n", true, true, true, true, false, false],
    ["syn\r\nthetic", false, false, true, false, false, false],
    ['"synthetic"', false, false, false, false, true, false],
    ["synthetic%20encoded", false, false, false, false, false, true],
  ])("detects synthetic key shape without changing the keys (%s)", async (value, leading, trailing, crlf, trimming, quotes, encoded) => {
    const read = async () => String(value);
    const loader = (options: { env: Environment }) => createConnectWiseConfigLoader({ ...options,
      createSecretReader: async () => read });
    const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 401 }));
    const result = await diagnoseCwAuth({ env, loadConfig: loader, fetchImpl, deep: true });
    for (const prefix of ["publicKey", "privateKey"]) {
      expect(result[`${prefix}HasLeadingWhitespace`]).toBe(leading);
      expect(result[`${prefix}HasTrailingWhitespace`]).toBe(trailing);
      expect(result[`${prefix}ContainsCrLf`]).toBe(crlf);
      expect(result[`${prefix}HasQuoteAtBoundary`]).toBe(quotes);
      expect(result[`${prefix}LooksUrlEncoded`]).toBe(encoded);
    }
    expect(result.trimmingWouldChangePublicKey).toBe(trimming);
    expect(result.trimmingWouldChangePrivateKey).toBe(trimming);
    const actual = new Headers(fetchImpl.mock.calls[0][1].headers).get("Authorization")!;
    expect(Buffer.from(actual.slice("Basic ".length), "base64").toString("utf8")).toBe(`${config.companyId}+${value}:${value}`);
    expect(JSON.stringify(result)).not.toContain(value);
    expect(JSON.stringify(result)).not.toContain(actual);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("uses UTF-8 once without URL encoding or adding a Member ID", async () => {
    const supplied = { ...config, publicKey: "synthetic+public-é", privateKey: "synthetic/private-ñ=" };
    const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 200 }));
    const result = await diagnoseCwAuth({ env, loadConfig: () => async () => supplied, fetchImpl, deep: true });
    const actual = new Headers(fetchImpl.mock.calls[0][1].headers).get("Authorization")!;
    expect(actual).toBe(`Basic ${Buffer.from(`${supplied.companyId}+${supplied.publicKey}:${supplied.privateKey}`, "utf8").toString("base64")}`);
    expect(result.authorizationPayloadMatchesProduction).toBe(true);
    expect(JSON.stringify(result)).not.toContain(supplied.publicKey);
    expect(JSON.stringify(result)).not.toContain(supplied.privateKey);
  });
  it.each([undefined, "", "  ", "operator-client"])("preserves optional clientId behavior (%s)", async clientId => {
    const fetchImpl = vi.fn(async (_url: string, _options: RequestInit) => new Response("sensitive body", { status: 200 }));
    const result = await diagnoseCwAuth({ env, loadConfig: () => async () => ({ ...config, clientId }), fetchImpl });
    expect(result.clientIdHeaderPresent).toBe(!!clientId?.trim());
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).get("clientId")).toBe(clientId?.trim() || null);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("uses only fixed Vault secrets and the existing local credential path without copying keys", async () => {
    const read = vi.fn(async (name: string) => name === "connectwise-public-key" ? keys.publicKey : keys.privateKey);
    const factory = vi.fn(async () => read);
    const loader = vi.fn((options: { env: Environment }) => createConnectWiseConfigLoader({ ...options, createSecretReader: factory }));
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const result = await diagnoseCwAuth({ env, loadConfig: loader, fetchImpl });
    expect(loader.mock.calls[0][0].env).toMatchObject({ NODE_ENV: "development", CW_CONFIG_SOURCE: "key-vault" });
    expect(env.NODE_ENV).toBe("production");
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual(["connectwise-private-key", "connectwise-public-key"]);
    expect(result.httpStatus).toBe(200); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("sanitizes network failure without retry and restores fetch", async () => {
    const previous = globalThis.fetch;
    const fetchImpl = vi.fn(async () => { throw new Error(`${authorization} ${keys.privateKey}`); });
    const result = await diagnoseCwAuth({ env, loadConfig, fetchImpl });
    expect(result).toMatchObject({ requestSent: true, connectionSucceeded: false, failureStage: "network" });
    expect(JSON.stringify(result)).not.toContain(keys.privateKey); expect(JSON.stringify(result)).not.toContain(authorization);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(globalThis.fetch).toBe(previous);
  });
  it("rejects unexpected path segments before sending and does not echo them", async () => {
    const fetchImpl = vi.fn();
    const result = await diagnoseCwAuth({ env, loadConfig: () => async () => ({ ...config,
      baseUrl: `${config.baseUrl}/${keys.privateKey}` }), fetchImpl });
    expect(result).toMatchObject({ requestSent: false, unexpectedExtraPathSegments: true, failureStage: "request_shape" });
    expect(fetchImpl).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain(keys.privateKey);
  });
  it.each([null, { ...config, publicKey: "" }, { ...config, privateKey: "" },
    { ...config, baseUrl: "http://cw.example" }, { ...config, rejectUnauthorized: false }])("does not send with missing/unsafe configuration", async value => {
    const fetchImpl = vi.fn();
    const result = await diagnoseCwAuth({ env, loadConfig: () => async () => value, fetchImpl });
    expect(result).toMatchObject({ requestSent: false, failureStage: "configuration" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("sanitizes Vault lookup failure and makes no CW request", async () => {
    const fetchImpl = vi.fn();
    const result = await diagnoseCwAuth({ env, loadConfig: () => async () => { throw new Error(keys.privateKey); }, fetchImpl });
    expect(result).toMatchObject({ requestSent: false, failureStage: "configuration" });
    expect(JSON.stringify(result)).not.toContain(keys.privateKey); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{ NODE_TLS_REJECT_UNAUTHORIZED: "0" }, { CW_MANAGE_REJECT_UNAUTHORIZED: "false" }])("refuses relaxed TLS before retrieving keys", async tls => {
    const fetchImpl = vi.fn();
    expect(await diagnoseCwAuth({ env: { ...env, ...tls }, loadConfig, fetchImpl })).toMatchObject({ requestSent: false,
      tlsVerification: false, failureStage: "configuration" });
    expect(loadConfig).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("allowlisted response metadata", () => {
  it("cannot leak arbitrary header values, challenge parameters, cookies or unknown header names", () => {
    const headers = new Headers({
      "Content-Type": `application/json; sensitive=${keys.privateKey}`,
      Server: `Microsoft-IIS/10.0 ${keys.privateKey}`,
      "WWW-Authenticate": `Basic realm="${keys.publicKey}, NTLM, Negotiate", Bearer error="${keys.privateKey}", NTLM`,
      Location: `https://secret.example/${keys.privateKey}`,
      "x-azure-ref": authorization, "x-arr-log-id": keys.publicKey, "x-powered-by": keys.privateKey,
      "Set-Cookie": keys.privateKey, Authorization: authorization,
      [`x-ms-${keys.privateKey}`]: keys.publicKey,
    });
    const get = vi.spyOn(headers, "get"), has = vi.spyOn(headers, "has");
    const result = safeResponseMetadata({ status: 401, redirected: false, headers });
    expect(result).toEqual({ responseContentType: "application/json", responseBodyMediaType: "application/json",
      serverHeader: "Microsoft-IIS", wwwAuthenticateSchemes: ["Basic", "Bearer", "NTLM"],
      locationHeaderPresent: true, responseWasRedirect: false,
      proxyHeaderNames: ["x-azure-ref", "x-arr-log-id", "x-powered-by"] });
    expect(get.mock.calls.map(call => call[0])).toEqual(["Content-Type", "Server", "WWW-Authenticate"]);
    expect(has.mock.calls.map(call => call[0])).not.toContain("Set-Cookie");
    const serialized = JSON.stringify(result);
    for (const secret of [keys.publicKey, keys.privateKey, authorization, "secret.example", "realm", "sensitive"]) {
      expect(serialized).not.toContain(secret);
    }
  });
  it.each([
    ['Negotiate, NTLM', ["Negotiate", "NTLM"]],
    ['Basic realm="redacted, NTLM", charset="UTF-8"', ["Basic"]],
    ['Bearer realm="redacted", Basic = "redacted", NTLM="redacted"', ["Bearer"]],
    ['Basic realm="escaped\\", Negotiate", Digest realm="redacted"', ["Basic", "Digest"]],
    ['UnknownScheme secret-parameter, Basic realm="redacted"', ["Basic"]],
    ['NTLM secret-token68==, NTLM, Basic realm="redacted"', ["NTLM", "Basic"]],
    ['Basic realm="unterminated, NTLM', []],
  ])("emits only recognized schemes from %s", (challenge, expected) => {
    expect(safeResponseMetadata({ status: 401, headers: new Headers({ "WWW-Authenticate": challenge }) })
      .wwwAuthenticateSchemes).toEqual(expected);
  });
  it.each([
    ["Microsoft-IIS/10.0", "Microsoft-IIS/10.0"], ["nginx/private-detail", "nginx"],
    [keys.privateKey, "other"], ["Apache sensitive-detail", "Apache"],
  ])("returns only fixed server families/allowlisted versions for %s", (server, expected) => {
    expect(safeResponseMetadata({ status: 401, headers: new Headers({ Server: server }) }).serverHeader).toBe(expected);
  });
  it.each([
    ["text/html; charset=utf-8", "text/html"], ["application/vnd.connectwise.com+json", "application/vnd.connectwise.com+json"],
    [`application/${keys.privateKey}+json`, "application/*+json"], [`text/${keys.privateKey}`, "other"],
  ])("categorizes media types without arbitrary values for %s", (type, expected) => {
    expect(safeResponseMetadata({ status: 401, headers: new Headers({ "Content-Type": type }) }).responseContentType).toBe(expected);
  });
  it("reports redirect status and Location presence without reading Location", () => {
    const headers = new Headers({ Location: `https://secret.example/${keys.privateKey}` });
    const get = vi.spyOn(headers, "get");
    const result = safeResponseMetadata({ status: 302, redirected: false, headers });
    expect(result).toMatchObject({ responseWasRedirect: true, locationHeaderPresent: true });
    expect(get.mock.calls.map(call => call[0])).not.toContain("Location");
    expect(JSON.stringify(result)).not.toContain(keys.privateKey);
  });
  it("adds response facts to the one existing GET, without reading its body", async () => {
    const response = new Response(keys.privateKey, { status: 401, headers: {
      "Content-Type": "text/html", Server: "Microsoft-IIS/10.0", "WWW-Authenticate": `Negotiate, NTLM ${keys.publicKey}`,
    } });
    const text = vi.spyOn(response, "text"), json = vi.spyOn(response, "json");
    const fetchImpl = vi.fn(async () => response);
    const result = await diagnoseCwAuth({ env, loadConfig, fetchImpl, deep: true });
    expect(result).toMatchObject({ httpStatus: 401, responseContentType: "text/html", serverHeader: "Microsoft-IIS/10.0",
      wwwAuthenticateSchemes: ["Negotiate", "NTLM"], responseWasRedirect: false });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(text).not.toHaveBeenCalled(); expect(json).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(keys.publicKey); expect(JSON.stringify(result)).not.toContain(keys.privateKey);
  });
});
