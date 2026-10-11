import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CwManageClient } from "./api-client.js";
import type { CwManageConfig } from "./config.js";
import { CustomerAccessError } from "./auth/customer-access.js";
import { withCustomerEvidence, customerAccessOutcome } from "./auth/customer-evidence.js";
import { customerTransport } from "./auth/customer-transport.js";
import { createMcpServer } from "./mcp-server.js";
import { type ConfigProvider, type Environment } from "./config.js";
import { createConnectWiseConfigLoader } from "./config-loader.js";
import { ConfigurationError, logDiagnostic, logAuthDiagnostic, logMcpDiagnostic } from "./diagnostics.js";
import { bearerChallenge, protectedResourceMetadata, type AuthenticationResult, type DescopeResourceConfig, type McpPrincipal } from "./auth/descope-mcp.js";

/** Verify issuer, audience and caller authorization before resolving any CW secrets.
 * Typed denials preserve safe OAuth responses; false/throws remain fail-closed.
 */
export type McpAuthenticator = (request: IncomingMessage) => Promise<boolean | AuthenticationResult>;
export function requireHttpAuthentication(env: Environment, authenticate?: McpAuthenticator): McpAuthenticator {
  if (env.AUTH_MODE && env.AUTH_MODE !== "env") throw new ConfigurationError("gateway-disabled");
  if (authenticate) return authenticate;
  const host = env.MCP_HTTP_HOST || "0.0.0.0";
  if (env.MCP_ALLOW_UNAUTHENTICATED_LOCAL === "true" &&
      ["127.0.0.1", "::1"].includes(host) && env.NODE_ENV !== "production") {
    return async () => true;
  }
  throw new ConfigurationError("http-auth-required");
}

export function createHttpHandler(options: {
  authenticate: McpAuthenticator;
  configProvider?: ConfigProvider;
  allowedOrigins?: readonly string[];
  authConfig?: DescopeResourceConfig;
  customerConfigProvider?: (principal: McpPrincipal) => Promise<CwManageConfig>;
  customerClientFactory?: (config: CwManageConfig) => { client: CwManageClient; close(): Promise<void> };
}) {
  const configProvider = options.customerConfigProvider ? undefined : options.configProvider ?? createConnectWiseConfigLoader();
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const reply = (status: number, error: string, challenge?: string) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
        ...(challenge ? { "WWW-Authenticate": challenge } : {}) });
      res.end(JSON.stringify({ error }));
    };
    let closeCustomer: (() => Promise<void>) | undefined;
    res.once("close", () => { void closeCustomer?.().catch(()=>{}); });
    try {
      const path = new URL(req.url || "/", "http://localhost").pathname;
      if (path === "/health") { reply(200, "ok"); return; }
      if (path === "/.well-known/oauth-protected-resource/mcp" && options.authConfig) {
        if (req.method !== "GET") { reply(405, "method_not_allowed"); return; }
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(protectedResourceMetadata(options.authConfig))); return;
      }
      if (path !== "/mcp") { reply(404, "not_found"); return; }
      // Observe the final HTTP status without inspecting any response body or headers.
      res.once("finish", () => logMcpDiagnostic(req, req.method, { status: res.statusCode }));
      if (req.headers.origin && !options.allowedOrigins?.includes(req.headers.origin)) {
        reply(403, "origin_denied"); return;
      }
      // The authentication boundary: no configuration, tools, or transport before this.
      let result: boolean | AuthenticationResult;
      try { result = await options.authenticate(req); }
      catch {
        logAuthDiagnostic(req, "authenticator_failed");
        reply(401, "invalid_token", options.authConfig ? bearerChallenge(options.authConfig, "invalid_token") : undefined);
        return;
      }
      if (result !== true && !(typeof result === "object" && result?.authenticated === true)) {
        const denial = typeof result === "object" && result?.authenticated === false ? result : undefined;
        reply(denial?.status ?? 401, denial?.error ?? "unauthorized",
          options.authConfig ? bearerChallenge(options.authConfig, denial?.error) : undefined);
        return;
      }
      customerAccessOutcome("request_denied");
      if (req.method !== "POST") { reply(405, "method_not_allowed"); return; }
      if (Object.keys(req.headers).some(name => name.startsWith("x-cw-"))) {
        reply(400, "per_request_credentials_disabled"); return;
      }
      let config: CwManageConfig | null;
      let requestClient: CwManageClient | undefined;
      if (options.customerConfigProvider) {
        if (typeof result !== "object" || !result.authenticated || !result.principal) { reply(403,"access_denied"); return; }
        if (Object.keys(req.headers).some(name=>["x-account-id","x-connection-id","x-customer-id"].includes(name)) ||
            new URL(req.url || "/","http://localhost").searchParams.has("accountId")) { reply(400,"invalid_request"); return; }
        config = await options.customerConfigProvider(result.principal);
        customerAccessOutcome("authorized");
        if (!config || config.rejectUnauthorized !== true) throw new CustomerAccessError();
        const factory = options.customerClientFactory ?? (value=>{
          const transport = customerTransport(value.baseUrl);
          return {client:new CwManageClient(value,transport.transport),close:transport.close};
        });
        const scoped = factory(config);
        closeCustomer = scoped.close;
        requestClient = scoped.client;
        if (res.destroyed) { await closeCustomer(); return; }
      } else config = await configProvider!();
      if (config?.rejectUnauthorized === false) throw new ConfigurationError("invalid-config");
      const server = createMcpServer(config, options.authConfig?.requiredScope, requestClient);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, enableJsonResponse: true,
      });
      res.on("close", () => {
        void Promise.all([transport.close(), server.close()]).catch(error => logDiagnostic("transport.failed", error));
      });
      await server.connect(transport);
      // The SDK already parses and validates JSON-RPC. Observe only an allowlisted method
      // at its transport boundary; do not read, copy, or retain the request body.
      const onmessage = transport.onmessage;
      transport.onmessage = (message, extra) => {
        logMcpDiagnostic(req, req.method, { rpcMethod: "method" in message ? message.method : undefined });
        onmessage?.(message, extra);
      };
      await transport.handleRequest(req, res);
    } catch (error) {
      await closeCustomer?.().catch(()=>{});
      if (error instanceof CustomerAccessError) {
        customerAccessOutcome(error.code);
        if (!res.headersSent) reply(error.code === "service_unavailable" ? 503 : 403,error.code);
        return;
      }
      customerAccessOutcome("service_unavailable");
      logDiagnostic("transport.failed", error);
      if (!res.headersSent) reply(500, "internal_error");
    }
  };
  return (req: IncomingMessage,res: ServerResponse): Promise<void> => {
    let isMcp: boolean;
    try {isMcp = new URL(req.url || "/","http://localhost").pathname === "/mcp";}
    catch {return handle(req,res);} // Keep the existing sanitized malformed-URL error boundary.
    return options.customerConfigProvider && isMcp ? withCustomerEvidence(req,()=>handle(req,res)) : handle(req,res);
  };
}
