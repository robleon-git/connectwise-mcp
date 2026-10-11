// Only an explicitly invoked temporary job uses this entrypoint. Never API startup.
import { Pool } from "pg";
import { ManagedIdentityCredential, logger as identityLogger } from "@azure/identity";
import { SecretClient, logger as secretLogger } from "@azure/keyvault-secrets";
import { bootstrapDatabase, bootstrapSettings, SERVICE_SECRETS } from "./bootstrap.js";
import { bootstrapMcpReader, MCP_DATABASE_SECRET } from "./mcp-bootstrap.js";
let pool: Pool | undefined;
try {
  const mcp = process.env.CW_BOOTSTRAP_CONFIRM === "INITIALIZE_CONNECTWISE_MCP_READER";
  const config = bootstrapSettings(mcp ? {...process.env,CW_BOOTSTRAP_CONFIRM:"INITIALIZE_CONNECTWISE_DATABASE"} : process.env);
  for (const logger of [identityLogger, secretLogger])
    for (const level of ["error", "warning", "info", "verbose"] as const) logger[level].log = () => {};
  const credential = new ManagedIdentityCredential({ loggingOptions: { enableUnsafeSupportLogging: false, allowLoggingAccountIdentifiers: false } });
  const vault = new SecretClient(config.vault, credential, { retryOptions: { maxRetries: 0 }, redirectOptions: { handleRedirects: false, maxRetries: 0 } });
  const get = async (name: string) => (await vault.getSecret(name, { abortSignal: AbortSignal.timeout(10000) })).value;
  const password = await get("cw-bootstrap-db-password");
  if (!password) throw new Error();
  pool = new Pool({ host: config.host, database: config.database, user: config.user, password,
    ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 10000, query_timeout: 30000 });
  pool.on("error", () => {});
  const result = await (mcp ? bootstrapMcpReader : bootstrapDatabase)(pool, { get, set: async (name, value) => {
    if (!(mcp ? [MCP_DATABASE_SECRET] : SERVICE_SECRETS as readonly string[]).includes(name)) throw new Error();
    await vault.setSecret(name, value, { abortSignal: AbortSignal.timeout(10000) });
  } });
  console.log(JSON.stringify(result));
} catch {
  console.error(JSON.stringify({ databaseBootstrapSucceeded: false, details: "redacted" }));
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch { process.exitCode = 1; }
}
