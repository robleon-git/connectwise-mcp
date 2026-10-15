#!/usr/bin/env node
import { createServer } from "node:http";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.js";
import { createHttpHandler, requireHttpAuthentication } from "./http-server.js";
import { logDiagnostic } from "./diagnostics.js";
import { createPrincipalAuthenticator, getDescopeResourceConfig } from "./auth/descope-mcp.js";
import { databasePool } from "./database/pool.js";
import { AccountAccessStore, createCustomerConfigProvider } from "./auth/customer-access.js";
import { managedCustomerCredentialReader } from "./auth/customer-vault.js";
import { migrationReadiness } from "./database/migrationManifest.js";
import { createConnectWiseConfigLoader } from "./config-loader.js";

async function main(): Promise<void> {
  if ((process.env.MCP_TRANSPORT || "stdio") === "stdio") {
    await createMcpServer(await createConnectWiseConfigLoader()()).connect(new StdioServerTransport());
    logDiagnostic("server.started");
    return;
  }
  // Incomplete OAuth configuration must fail before binding a public socket.
  // Hosted HTTP has exactly one execution path: customer identity/account/entitlement resolution.
  // Pilot env keys and the approved-user allowlist are never consulted here. stdio remains local-only.
  const authConfig = getDescopeResourceConfig();
  const authenticate = requireHttpAuthentication(process.env,createPrincipalAuthenticator(authConfig));
  if (process.env.CW_DB_USER !== "cw_mcp" || process.env.CW_DB_PASSWORD_SECRET !== "cw-mcp-db-password" ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("invalid_mcp_configuration");
  const pool = databasePool(process.env);
  try {
    if (!await migrationReadiness(pool)) throw new Error();
  } catch { await pool.end(); throw new Error("mcp_database_unavailable"); }
  let server: ReturnType<typeof createServer>;
  try {
    const customerConfigProvider = createCustomerConfigProvider(new AccountAccessStore(pool,authConfig.issuer),managedCustomerCredentialReader());
    const handler = createHttpHandler({ authenticate, authConfig, customerConfigProvider });
    server = createServer((req, res) => { void handler(req, res); });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(Number(process.env.MCP_HTTP_PORT || "8080"), process.env.MCP_HTTP_HOST || "0.0.0.0", resolve);
    });
  } catch (error) { await pool.end(); throw error; }
  logDiagnostic("server.started");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => server.close(() => { logDiagnostic("server.stopped"); void pool.end().then(()=>process.exit(0)).catch(()=>process.exit(1)); }));
  }
}
main().catch(error => { logDiagnostic("server.failed", error); process.exitCode = 1; });
