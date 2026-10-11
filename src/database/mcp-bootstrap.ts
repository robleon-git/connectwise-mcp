import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BOOTSTRAP_PENDING, type BootstrapSecretStore } from "./bootstrap.js";
export const MCP_DATABASE_SECRET = "cw-mcp-db-password";
/** Separately invoked one-shot extension; never API startup and never re-runs the initial bootstrap. */
export async function bootstrapMcpReader(pool: Pick<Pool,"connect">, secrets: BootstrapSecretStore,
  generate: ()=>string = ()=>randomBytes(32).toString("hex")) {
  let db: PoolClient|undefined, locked=false, transaction=false;
  try {
    db = await pool.connect();
    await db.query("SET statement_timeout='30s'; SET lock_timeout='10s'");
    const target = (await db.query("SELECT current_database() AS database,session_user AS username")).rows[0];
    if(target?.database!=="connectwise" || target?.username!=="cw_bootstrap_admin")throw new Error();
    locked=(await db.query("SELECT pg_try_advisory_lock(hashtext('connectwise_mcp_reader_bootstrap_v1')) AS locked")).rows[0]?.locked===true;
    if(!locked || (await db.query("SELECT rolname FROM pg_roles WHERE rolname='cw_mcp'")).rows.length || await secrets.get(MCP_DATABASE_SECRET)!==BOOTSTRAP_PENDING)throw new Error();
    const password=generate(); if(!/^[a-f0-9]{64}$/.test(password))throw new Error();
    await secrets.set(MCP_DATABASE_SECRET,password);
    await db.query("BEGIN"); transaction=true;
    await db.query(`CREATE ROLE cw_mcp LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
    await db.query("GRANT CONNECT ON DATABASE connectwise TO cw_mcp; REVOKE cw_mcp FROM cw_bootstrap_admin");
    await db.query("COMMIT"); transaction=false;
    return {mcpReaderBootstrapSucceeded:true} as const;
  } catch {if(transaction)await db?.query("ROLLBACK").catch(()=>{});throw new Error("mcp_reader_bootstrap_failed");}
  finally {if(locked)await db?.query("SELECT pg_advisory_unlock(hashtext('connectwise_mcp_reader_bootstrap_v1'))").catch(()=>{});db?.release();}
}
