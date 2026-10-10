import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

/** Operator-provisioned NONSECRET placeholders permit secret-scoped RBAC before execution. */
export const BOOTSTRAP_PENDING = "__CW_DATABASE_BOOTSTRAP_PENDING__";
export const SERVICE_SECRETS = ["cw-control-db-password", "cw-migration-db-password"] as const;
export interface BootstrapSecretStore {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
}

/** One-shot, no retries or rotation. No network/secret work is done on module import. */
export async function bootstrapDatabase(pool: Pick<Pool, "connect">, secrets: BootstrapSecretStore,
  generate: () => string = () => randomBytes(32).toString("hex")) {
  let client: PoolClient | undefined;
  let locked = false, transaction = false;
  try {
    client = await pool.connect();
    await client.query("SET statement_timeout = '30s'; SET lock_timeout = '10s'");
    const target = await client.query("SELECT current_database() AS database, session_user AS username");
    if (target.rows[0]?.database !== "connectwise" || target.rows[0]?.username !== "cw_bootstrap_admin")
      throw new Error();
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('connectwise_database_bootstrap_v1')) AS locked")).rows[0]?.locked === true;
    if (!locked) throw new Error();
    if ((await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('cw_control','cw_migrator')")).rows.length)
      throw new Error();
    for (const name of SERVICE_SECRETS)
      if (await secrets.get(name) !== BOOTSTRAP_PENDING) throw new Error();
    const passwords = SERVICE_SECRETS.map(() => generate());
    if (passwords.some(value => !/^[a-f0-9]{64}$/.test(value)) || passwords[0] === passwords[1]) throw new Error();
    // Vault is not transactional with PostgreSQL. A partial write requires operator reconciliation.
    for (const [index, name] of SERVICE_SECRETS.entries()) await secrets.set(name, passwords[index]);
    await client.query("BEGIN"); transaction = true;
    await client.query(`CREATE ROLE cw_control LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords[0]}'; CREATE ROLE cw_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${passwords[1]}'`);
    await client.query("REVOKE ALL ON DATABASE connectwise FROM PUBLIC; GRANT CONNECT ON DATABASE connectwise TO cw_control,cw_migrator; REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE,CREATE ON SCHEMA public TO cw_migrator; GRANT cw_migrator TO cw_bootstrap_admin WITH INHERIT FALSE, SET TRUE; GRANT USAGE ON SCHEMA public TO cw_control; SET LOCAL ROLE cw_migrator; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cw_control; RESET ROLE; REVOKE cw_migrator FROM cw_bootstrap_admin; REVOKE cw_control FROM cw_bootstrap_admin");
    await client.query("COMMIT"); transaction = false;
    return { databaseBootstrapSucceeded: true } as const;
  } catch {
    if (transaction) await client?.query("ROLLBACK").catch(() => {});
    throw new Error("database_bootstrap_failed");
  } finally {
    if (locked) await client?.query("SELECT pg_advisory_unlock(hashtext('connectwise_database_bootstrap_v1'))").catch(() => {});
    client?.release();
  }
}

export function bootstrapSettings(env: NodeJS.ProcessEnv) {
  if (env.NODE_ENV !== "production" || env.CW_BOOTSTRAP_CONFIRM !== "INITIALIZE_CONNECTWISE_DATABASE" ||
      env.CW_DB_HOST !== "monotorr-cw-db-01.postgres.database.azure.com" ||
      env.CW_DB_NAME !== "connectwise" || env.CW_DB_USER !== "cw_bootstrap_admin" ||
      env.CW_KEY_VAULT_URI !== "https://cw-mcp-kv.vault.azure.net" || env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("invalid_bootstrap_configuration");
  return { host: env.CW_DB_HOST!, database: "connectwise", user: "cw_bootstrap_admin", vault: env.CW_KEY_VAULT_URI };
}
