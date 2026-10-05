#!/usr/bin/env node
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { createHttpHandler, requireHttpAuthentication } from "./http-server.js";
import { logDiagnostic } from "./diagnostics.js";
import { createDescopeMcpAuthenticator, getDescopeMcpConfig } from "./auth/descope-mcp.js";

async function main(): Promise<void> {
  if ((process.env.MCP_TRANSPORT || "stdio") === "stdio") {
    await createMcpServer().connect(new StdioServerTransport());
    logDiagnostic("server.started");
    return;
  }
  // Incomplete OAuth configuration must fail before binding a public socket.
  const authConfig = getDescopeMcpConfig();
  const authenticate = requireHttpAuthentication(process.env,
    authConfig ? createDescopeMcpAuthenticator(authConfig) : undefined);
  const handler = createHttpHandler({ authenticate, authConfig });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(process.env.MCP_HTTP_PORT || "8080"), process.env.MCP_HTTP_HOST || "0.0.0.0", resolve);
  });
  logDiagnostic("server.started");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => { logDiagnostic("server.stopped"); process.exit(0); }));
  }
}
main().catch(error => { logDiagnostic("server.failed", error); process.exitCode = 1; });
