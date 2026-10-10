import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CustomerContext } from "../control-plane/auth/store.js";
import { ConnectionError } from "./errors.js";
export interface Reservation { id:string; accountId:string; baseUrl:string; companyId:string }
const ownership = `JOIN public.account_memberships m ON m.account_id=a.id JOIN public.users u ON u.id=m.user_id
  WHERE a.id=$1 AND u.id=$2 AND m.role='owner' AND a.status='active' AND u.status='active'`;
const eligible = `SELECT a.id FROM public.accounts a ${ownership} AND EXISTS(SELECT 1 FROM public.entitlements e WHERE e.account_id=a.id AND e.source='trial'
  AND e.status='active' AND e.starts_at<=clock_timestamp() AND e.ends_at>clock_timestamp())`;
export class ConnectionStore {
  constructor(private readonly pool:Pool) {}
  async status(context:CustomerContext) {
    const result=await this.pool.query<{status:string|null;server_url:string|null;company_id:string|null}>(`SELECT c.status,c.server_url,c.company_id FROM public.accounts a
      LEFT JOIN public.connectwise_connections c ON c.account_id=a.id ${ownership}`,[context.accountId,context.userId]);
    if(result.rows.length!==1) throw new ConnectionError("entitlement_required",403);
    const row=result.rows[0];
    return row.status==='connected' ? {status:"connected" as const,host:new URL(row.server_url!).hostname,companyId:row.company_id!} : {status:"not_configured" as const};
  }
  private async allowed(db:Pick<PoolClient,"query">,context:CustomerContext) {
    if((await db.query(eligible,[context.accountId,context.userId])).rows.length!==1) throw new ConnectionError("entitlement_required",403);
  }
  async reserve(context:CustomerContext,metadata:{baseUrl:string;companyId:string},validate:()=>Promise<void>,cleanup:(id:string)=>Promise<void>):Promise<Reservation> {
    const db=await this.pool.connect();
    try {
      await db.query("BEGIN"); await db.query("SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='45s'");
      await this.allowed(db,context);
      const locked=await db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[`cw-connection:${context.accountId}`]);
      if(!locked.rows[0]?.locked) throw new ConnectionError("setup_in_progress",409);
      const existing=await db.query<{id:string;status:string;stale:boolean}>("SELECT id,status,created_at<clock_timestamp()-interval '5 minutes' AS stale FROM public.connectwise_connections WHERE account_id=$1",[context.accountId]);
      if(existing.rows.length) {
        const row=existing.rows[0];
        if(row.status==='connected') throw new ConnectionError("already_configured",409);
        if(row.status==='persisting'&&!row.stale) throw new ConnectionError("setup_in_progress",409);
        // A durable pending locator is reclaimed only after its bounded operation can no longer be running.
        await cleanup(row.id);
        await db.query("DELETE FROM public.connectwise_connections WHERE account_id=$1 AND id=$2 AND status<>'connected'",[context.accountId,row.id]);
      }
      await validate(); await this.allowed(db,context);
      const id=randomUUID();
      await db.query("INSERT INTO public.connectwise_connections(id,account_id,server_url,company_id,status,validated_at) VALUES($1,$2,$3,$4,'persisting',clock_timestamp())",[id,context.accountId,metadata.baseUrl,metadata.companyId]);
      await db.query("COMMIT");
      return {id,accountId:context.accountId,...metadata};
    } catch(error) { await db.query("ROLLBACK").catch(()=>{}); if(error instanceof ConnectionError)throw error; throw new ConnectionError("storage_unavailable",503); }
    finally {db.release();}
  }
  async activate(context:CustomerContext,id:string,refs:{publicRef:string;privateRef:string}) {
    const result=await this.pool.query(`UPDATE public.connectwise_connections c SET status='connected',public_secret_ref=$3,private_secret_ref=$4,updated_at=clock_timestamp()
      WHERE c.id=$5 AND c.account_id=$1 AND c.status='persisting' AND EXISTS(${eligible}) RETURNING id`,[context.accountId,context.userId,refs.publicRef,refs.privateRef,id]);
    if(result.rowCount!==1) throw new ConnectionError("entitlement_required",403);
  }
  async cleanupState(context:CustomerContext,id:string) {
    // Atomic conditional update prevents cleanup from deleting a successfully committed active pair.
    const marked=await this.pool.query(`UPDATE public.connectwise_connections c SET status='cleanup_required',updated_at=clock_timestamp()
      WHERE c.account_id=$1 AND c.id=$3 AND c.status='persisting' AND EXISTS(SELECT 1 FROM public.accounts a ${ownership}) RETURNING id`,[context.accountId,context.userId,id]);
    if(marked.rowCount===1) return "cleanup" as const;
    const result=await this.pool.query<{status:string;public_secret_ref:string|null;private_secret_ref:string|null}>(`SELECT c.status,c.public_secret_ref,c.private_secret_ref FROM public.accounts a
      JOIN public.connectwise_connections c ON c.account_id=a.id ${ownership} AND c.id=$3`,[context.accountId,context.userId,id]);
    if(result.rows.length!==1) throw new ConnectionError("storage_unavailable",503);
    const row=result.rows[0]; return row.status==='connected' ? row : "cleanup" as const;
  }
  async removePending(context:CustomerContext,id:string) {
    await this.pool.query(`DELETE FROM public.connectwise_connections c WHERE c.account_id=$1 AND c.id=$3 AND c.status='cleanup_required'
      AND EXISTS(SELECT 1 FROM public.accounts a ${ownership})`,[context.accountId,context.userId,id]);
  }
}
