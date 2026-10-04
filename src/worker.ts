import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp-server.js";
import { getConfig, type Environment, type ConfigProvider } from "./config.js";
import { logDiagnostic } from "./diagnostics.js";
export type Env = Environment;
/** No default remote authenticator. Inject a standards-compliant verifier before deployment. */
export function createWorker(options: {
  authenticate?: (request: Request) => Promise<boolean>;
  configProvider?: ConfigProvider;
} = {}) {
  return { async fetch(request: Request, env: Env): Promise<Response> {
    const json = (error: string, status: number) => Response.json({ error }, { status });
    const path = new URL(request.url).pathname;
    if (path === "/health" || path === "/healthz") return Response.json({ status: "ok" });
    if (path !== "/mcp") return json("not_found", 404);
    if (!options.authenticate) return json("authentication_not_configured", 503);
    try {
      if (request.headers.has("origin")) return json("origin_denied", 403);
      if (!await options.authenticate(request)) return json("unauthorized", 401);
      if (request.method !== "POST") return json("method_not_allowed", 405);
      if (env.AUTH_MODE === "gateway" || [...request.headers.keys()].some(name => name.startsWith("x-cw-"))) {
        return json("per_request_credentials_disabled", 400);
      }
      const config = await (options.configProvider ?? (() => getConfig(env)))();
      if (config?.rejectUnauthorized === false) return json("invalid_configuration", 503);
      const server = createMcpServer(config);
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      try {
        await server.connect(transport);
        return await transport.handleRequest(request);
      } finally { await transport.close(); await server.close(); }
    } catch (error) { logDiagnostic("transport.failed", error); return json("internal_error", 500); }
  } };
}
export default createWorker();
