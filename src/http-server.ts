import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-server.js";
import { type ConfigProvider, type Environment } from "./config.js";
import { createConnectWiseConfigLoader } from "./config-loader.js";
import { ConfigurationError, logDiagnostic, logAuthDiagnostic, logMcpDiagnostic } from "./diagnostics.js";
import { bearerChallenge, protectedResourceMetadata, type AuthenticationResult, type DescopeMcpConfig } from "./auth/descope-mcp.js";

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
  authConfig?: DescopeMcpConfig;
}) {
  const configProvider = options.configProvider ?? createConnectWiseConfigLoader();
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const reply = (status: number, error: string, challenge?: string) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
        ...(challenge ? { "WWW-Authenticate": challenge } : {}) });
      res.end(JSON.stringify({ error }));
    };
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
      if (req.method !== "POST") { reply(405, "method_not_allowed"); return; }
      if (Object.keys(req.headers).some(name => name.startsWith("x-cw-"))) {
        reply(400, "per_request_credentials_disabled"); return;
      }
      const config = await configProvider();
      if (config?.rejectUnauthorized === false) throw new ConfigurationError("invalid-config");
      const server = createMcpServer(config, options.authConfig?.requiredScope);
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
      logDiagnostic("transport.failed", error);
      if (!res.headersSent) reply(500, "internal_error");
    }
  };
}
