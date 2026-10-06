import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const path = "../../scripts/diagnose-live-mcp.mjs";
type Event = Record<string, unknown>;
type Logs = { status: string; events: Event[] };
interface Operator {
  main: (options: { args: string[]; run: (options: { freshLogin: boolean; env: Record<string, string | undefined>;
    openBrowser: (url: string) => Promise<boolean> }) => Promise<unknown>;
    openBrowser?: (url: string) => Promise<boolean>; azure?: () => Promise<Logs>;
    output: (text: string) => void; progress: (text: string) => void }) => Promise<number>;
  retrieveAzureDiagnostics: (command: (args: string[]) => Promise<string>, options?: { pause: (delay: number) => Promise<void> }) => Promise<Logs>;
  filterAzureLogs: (text: string) => Event[];
  safeAzureEvent: (input: unknown) => Event | undefined;
}
const operator = await import(path) as Operator;
const requestId = "22222222-2222-4222-8222-222222222222";
const success = { resourceTokenVerified: true, approvedIdMatchPaths: ["/sub"],
  mcpInitializeSucceeded: true, toolsListSucceeded: true, protocolVersion: "2025-11-25",
  toolCount: 1, toolNames: ["cw_test_connection"] };

describe("simple local operator workflow", () => {
  it("requests a fresh browser interaction and prints a whitelisted success summary", async () => {
    const output = vi.fn(), progress = vi.fn(), openBrowser = vi.fn(async () => true);
    const run = vi.fn(async options => {
      expect(options.freshLogin).toBe(true);
      expect(Object.keys(options.env)).toEqual(["NODE_TLS_REJECT_UNAUTHORIZED"]);
      await options.openBrowser("https://identity.example/authorize?prompt=login");
      return { ...success, access_token: "PRIVATE-ACCESS", claims: { sub: "PRIVATE-IDENTITY" } };
    });
    expect(await operator.main({ args: [], run, openBrowser, output, progress })).toBe(0);
    expect(progress).toHaveBeenCalledWith("Opening browser for fresh Monotorr SAML authentication...");
    expect(openBrowser).toHaveBeenCalledOnce();
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({ ...success, approvedIdMatched: true });
    expect(JSON.stringify([...output.mock.calls, ...progress.mock.calls])).not.toContain("PRIVATE");
  });
  it("a verified no-match produces only the actionable summary and skips Azure", async () => {
    const output = vi.fn(), progress = vi.fn(), azure = vi.fn();
    expect(await operator.main({ args: ["--azure-logs"],
      run: async () => ({ resourceTokenVerified: true, approvedIdMatchPaths: [], access_token: "PRIVATE" }),
      azure, output, progress })).toBe(2);
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({ resourceTokenVerified: true, approvedIdMatched: false,
      nextAction: "Re-authenticate with the intended Monotorr SAML identity" });
    expect(azure).not.toHaveBeenCalled();
  });
  it("preserves sanitized MCP failure stages and status", async () => {
    const output = vi.fn();
    expect(await operator.main({ args: [], run: async () => ({ ...success, toolsListSucceeded: false,
      failureStage: "tools/list", httpStatus: 403 }), output, progress: vi.fn() })).toBe(3);
    expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({ approvedIdMatched: true, failureStage: "tools/list", httpStatus: 403 });
  });
  it("discards raw OAuth exceptions and rejects unknown/token CLI arguments", async () => {
    const output = vi.fn(), run = vi.fn(async () => { throw new Error("Bearer PRIVATE claims sub email"); });
    expect(await operator.main({ args: [], run, output, progress: vi.fn() })).toBe(1);
    expect(JSON.parse(output.mock.calls[0][0])).toEqual({ resourceTokenVerified: false,
      approvedIdMatched: false, failureStage: "oauth_or_token_validation" });
    run.mockClear();
    expect(await operator.main({ args: ["--token=PRIVATE"], run, output, progress: vi.fn() })).toBe(1);
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(output.mock.calls)).not.toContain("PRIVATE");
  });
  it("Azure CLI errors do not turn successful OAuth/MCP into failure", async () => {
    const output = vi.fn(), progress = vi.fn();
    expect(await operator.main({ args: ["--azure-logs"], run: async () => success,
      azure: async () => { throw new Error("PRIVATE CLI stderr Bearer token"); }, output, progress })).toBe(0);
    expect(progress).toHaveBeenCalledWith('{"azureDiagnosticsRetrieved":false,"structuredEventsFound":false,"reason":"azure_cli_unavailable"}');
    expect(JSON.stringify([...output.mock.calls, ...progress.mock.calls])).not.toContain("PRIVATE");
  });
});

describe("read-only dynamic Azure log retrieval", () => {
  it("discovers current revisions/replicas/containers instead of using prior names", async () => {
    const revision = "connectwise-mcp-pilot--future123";
    const replica = revision + "-abc-xyz";
    const command = vi.fn(async args => {
      if (args[1] === "revision") return JSON.stringify([revision]);
      if (args[1] === "replica") return JSON.stringify([{ name: replica, containers: ["pilot-container"] }]);
      return JSON.stringify({ Log: JSON.stringify({ event: "auth.accepted", requestId, claimPath: "/sub" }) });
    });
    expect(await operator.retrieveAzureDiagnostics(command)).toEqual({ status: "retrieved",
      events: [{ event: "auth.accepted", requestId, claimPath: "/sub" }] });
    expect(command.mock.calls[0][0]).toContain("[?properties.active].name");
    expect(command.mock.calls[1][0]).toContain(revision);
    expect(command.mock.calls[2][0]).toEqual(["containerapp", "logs", "show", "--name", "connectwise-mcp-pilot",
      "--resource-group", "monotorr-dev-eastus-rg", "--revision", revision, "--replica", replica,
      "--container", "pilot-container", "--type", "console", "--tail", "300", "--format", "json", "--only-show-errors"]);
    expect(JSON.stringify(command.mock.calls)).not.toMatch(/0000002|--follow|update|delete|deploy/);
  });
  it.each(["missing CLI", "expired login", "missing extension"])("suppresses %s details", async () => {
    expect(await operator.retrieveAzureDiagnostics(async () => { throw new Error("PRIVATE raw stderr"); }))
      .toEqual({ status: "unavailable", events: [] });
  });
  it("parses representative Azure NDJSON, bare JSON and CRI full records without leaking payloads", () => {
    const fixture = readFileSync(new URL("./fixtures/azure-console-logs.ndjson", import.meta.url), "utf8");
    const expected = [{ event: "auth.accepted", requestId, claimPath: "/sub" },
      { event: "mcp.request", requestId, method: "POST", path: "/mcp", rpcMethod: "initialize" },
      { event: "mcp.response", requestId, method: "POST", path: "/mcp", status: 200 }];
    expect(operator.filterAzureLogs(fixture)).toEqual(expected);
    const rows = fixture.trim().split("\n").map(line => JSON.parse(line));
    expect(operator.filterAzureLogs(JSON.stringify(rows))).toEqual(expected);
    expect(operator.filterAzureLogs(JSON.stringify(JSON.stringify(rows)))).toEqual(expected);
    expect(operator.filterAzureLogs(JSON.stringify({ Log_s: rows[1].Log }))).toEqual([expected[0]]);
    expect(JSON.stringify(operator.filterAzureLogs(fixture))).not.toMatch(/PRIVATE|Bearer|Authorization|cookie|body|TimeStamp/);
  });
  it("waits briefly and rediscovers targets until delayed events are visible", async () => {
    const pause = vi.fn(async () => {});
    let snapshots = 0, attempts = 0;
    const command = vi.fn(async args => {
      if (args[1] === "revision") {
        attempts++;
        return JSON.stringify([`connectwise-mcp-pilot--attempt${attempts}`]);
      }
      if (args[1] === "replica") return JSON.stringify([{ name: "current-replica", containers: ["pilot"] }]);
      snapshots++;
      return snapshots < 3 ? '{"Log":"No matching diagnostic yet"}'
        : JSON.stringify({ Log: JSON.stringify({ event: "auth.accepted", requestId, claimPath: "/sub" }) });
    });
    expect(await operator.retrieveAzureDiagnostics(command, { pause })).toEqual({ status: "retrieved",
      events: [{ event: "auth.accepted", requestId, claimPath: "/sub" }] });
    expect(pause.mock.calls).toEqual([[2000], [4000]]);
    expect(attempts).toBe(3);
    expect(command.mock.calls.filter(([args]) => args[1] === "logs").map(([args]) => args[args.indexOf("--revision") + 1]))
      .toEqual(["connectwise-mcp-pilot--attempt1", "connectwise-mcp-pilot--attempt2", "connectwise-mcp-pilot--attempt3"]);
  });
  it("stops bounded retries and reports no events without confusing retrieval with emission", async () => {
    const pause = vi.fn(async () => {});
    const command = vi.fn(async args => args[1] === "revision" ? '["connectwise-mcp-pilot--now"]'
      : args[1] === "replica" ? '[{"name":"current-replica","containers":["pilot"]}]'
        : '{"Log":"No matching events"}');
    const result = await operator.retrieveAzureDiagnostics(command, { pause });
    expect(result).toEqual({ status: "retrieved", events: [] });
    expect(pause).toHaveBeenCalledTimes(2);
    const output = vi.fn(), progress = vi.fn();
    expect(await operator.main({ args: ["--azure-logs"], run: async () => success,
      azure: async () => result, output, progress })).toBe(0);
    expect(progress).toHaveBeenCalledWith('{"azureDiagnosticsRetrieved":true,"structuredEventsFound":false,"reason":"no_matching_events"}');
    expect(JSON.stringify(progress.mock.calls)).not.toContain('"azureDiagnostics":"retrieved"');
  });
  it("deduplicates repeated safe events across snapshots and containers", async () => {
    const command = vi.fn(async args => args[1] === "revision" ? '["connectwise-mcp-pilot--now"]'
      : args[1] === "replica" ? '[{"name":"current-replica","containers":["pilot","sidecar"]}]'
        : JSON.stringify({ Log: JSON.stringify({ event: "auth.accepted", requestId, claimPath: "/sub" }) }));
    const result = await operator.retrieveAzureDiagnostics(command, { pause: vi.fn() });
    expect(result.events).toHaveLength(1);
    const output = vi.fn(), progress = vi.fn();
    expect(await operator.main({ args: ["--azure-logs"], run: async () => success,
      azure: async () => result, output, progress })).toBe(0);
    expect(progress).toHaveBeenCalledWith('{"azureDiagnosticsRetrieved":true,"structuredEventsFound":true,"eventCount":1}');
  });
  it("does not count rejected unsafe events as evidence", async () => {
    const progress = vi.fn();
    expect(await operator.main({ args: ["--azure-logs"], run: async () => success, output: vi.fn(), progress,
      azure: async () => ({ status: "retrieved", events: [{ event: "auth.accepted", requestId: "Bearer PRIVATE" }] }) })).toBe(0);
    expect(progress.mock.calls).toEqual([['{"azureDiagnosticsRetrieved":true,"structuredEventsFound":false,"reason":"no_matching_events"}']]);
  });
  it("reconstructs safe facts from JSON envelopes and drops tokens/claims/unknown fields", () => {
    const event = { event: "auth.denied", requestId, reason: "approved_user_mismatch", claimPath: "/sub",
      Authorization: "Bearer PRIVATE", access_token: "eyJhbGciOiJSUzI1NiJ9.PRIVATE.signature",
      sub: "PRIVATE-ID", email: "PRIVATE-EMAIL", claims: { user: "PRIVATE" }, cookies: "PRIVATE" };
    const output = operator.filterAzureLogs([
      "Bearer PRIVATE unstructured body", JSON.stringify({ Log: JSON.stringify(event) }),
      JSON.stringify({ Log: JSON.stringify({ ...event, reason: "Bearer PRIVATE" }) }),
      JSON.stringify({ event: "mcp.request", requestId, method: "POST", path: "/mcp",
        rpcMethod: "tools/list", params: "PRIVATE" }),
      JSON.stringify({ event: "mcp.response", requestId, method: "POST", path: "/mcp", status: 200, body: "PRIVATE" }),
      JSON.stringify({ event: "server.failed", requestId, message: "PRIVATE" }),
    ].join("\n"));
    expect(output).toEqual([{ event: "auth.denied", requestId, reason: "approved_user_mismatch", claimPath: "/sub" },
      { event: "mcp.request", requestId, method: "POST", path: "/mcp", rpcMethod: "tools/list" },
      { event: "mcp.response", requestId, method: "POST", path: "/mcp", status: 200 }]);
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE|Authorization|claims|email|cookies|eyJ/);
    expect(operator.safeAzureEvent({ ...event, requestId: "Bearer PRIVATE" })).toBeUndefined();
    expect(operator.safeAzureEvent({ ...event, requestId: { sub: "PRIVATE" } })).toBeUndefined();
  });
  it("applies the safety filter again before writing Azure output", async () => {
    const output = vi.fn(), progress = vi.fn();
    expect(await operator.main({ args: ["--azure-logs"], run: async () => success,
      azure: async () => ({ status: "retrieved", events: [{ event: "auth.accepted", requestId,
        claimPath: "/sub", token: "PRIVATE" }] }), output, progress })).toBe(0);
    expect(progress).toHaveBeenCalledWith(JSON.stringify({ event: "auth.accepted", requestId, claimPath: "/sub" }));
    expect(JSON.stringify(progress.mock.calls)).not.toContain("PRIVATE");
  });
});
