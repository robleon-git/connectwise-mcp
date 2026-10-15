import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { CustomerContext } from "../control-plane/auth/store.js";
import { VALID_ENTITLEMENT_SQL } from "../entitlements/service.js";
import { ConnectionError } from "./errors.js";
export interface SavedConnection { id:string; server_url:string; company_id:string; public_secret_ref:string; private_secret_ref:string }
export interface Reservation { id:string; accountId:string; baseUrl:string; companyId:string }
const ownership = `JOIN public.account_memberships m ON m.account_id=a.id JOIN public.users u ON u.id=m.user_id
  WHERE a.id=$1 AND u.id=$2 AND m.role='owner' AND a.status='active' AND u.status='active'`;
const eligible = `SELECT a.id FROM public.accounts a ${ownership} AND EXISTS(SELECT 1 FROM public.entitlements e WHERE e.account_id=a.id AND ${VALID_ENTITLEMENT_SQL})`;
export class ConnectionStore {
  constructor(private readonly pool:Pool) {}
  async status(context:CustomerContext) {
    const result=await this.pool.query<{status:string|null;server_url:string|null;company_id:string|null}>(`SELECT c.status,c.server_url,c.company_id FROM public.accounts a
      LEFT JOIN public.connectwise_connections c ON c.account_id=a.id ${ownership}`,[context.accountId,context.userId]);
    if(result.rows.length!==1) throw new ConnectionError("entitlement_required",403);
    const row=result.rows[0];
    return row.status==='connected' ? {status:"connected" as const,host:new URL(row.server_url!).hostname,serverUrl:row.server_url!,companyId:row.company_id!} : {status:"not_configured" as const};
  }
  private async allowed(db:Pick<PoolClient,"query">,context:CustomerContext) {
    if((await db.query(eligible,[context.accountId,context.userId])).rows.length!==1) throw new ConnectionError("entitlement_required",403);
  }
  /** All lifecycle operations share setup's account lock; the old row stays visible until commit. */
  private async withActive<T>(context:CustomerContext,access:boolean,work:(db:PoolClient,row:SavedConnection,check:()=>Promise<void>)=>Promise<T>):Promise<T> {
    const db=await this.pool.connect();
    try {
      await db.query("BEGIN; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='90s'");
      if((await db.query(`SELECT a.id FROM public.accounts a ${ownership}`,[context.accountId,context.userId])).rows.length!==1)throw new ConnectionError("entitlement_required",403);
      const lock=await db.query<{locked:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[`cw-connection:${context.accountId}`]);
      if(!lock.rows[0]?.locked)throw new ConnectionError("setup_in_progress",409);
      const check=()=>this.allowed(db,context);
      if(access)await check();
      const result=await db.query<SavedConnection>("SELECT id,server_url,company_id,public_secret_ref,private_secret_ref FROM public.connectwise_connections WHERE account_id=$1 AND status='connected'",[context.accountId]);
      if(result.rows.length!==1)throw new ConnectionError("not_configured",404);
      const value=await work(db,result.rows[0],check);await db.query("COMMIT");return value;
    } catch(error) {await db.query("ROLLBACK").catch(()=>{});if(error instanceof ConnectionError)throw error;throw new ConnectionError("storage_unavailable",503);}
    finally {db.release();}
  }
  async test(context:CustomerContext,validate:(row:SavedConnection)=>Promise<void>) {
    return this.withActive(context,true,async(_db,row,check)=>{await validate(row);await check();});
  }
  async replace(context:CustomerContext,id:string,metadata:{baseUrl:string;companyId:string},prepare:(row:SavedConnection,check:()=>Promise<void>)=>Promise<{publicRef:string;privateRef:string}>) {
    return this.withActive(context,true,async(db,row,check)=>{
      const refs=await prepare(row,check);await check();
      // Existing INSERT/DELETE grants suffice. Both changes commit together; readers never see a gap.
      await db.query("DELETE FROM public.connectwise_connections WHERE account_id=$1 AND id=$2",[context.accountId,row.id]);
      await db.query(`INSERT INTO public.connectwise_connections(id,account_id,server_url,company_id,status,validated_at,public_secret_ref,private_secret_ref)
        VALUES($1,$2,$3,$4,'connected',clock_timestamp(),$5,$6)`,[id,context.accountId,metadata.baseUrl,metadata.companyId,refs.publicRef,refs.privateRef]);
      return row.id;
    });
  }
  async disconnect(context:CustomerContext) {
    return this.withActive(context,false,async(db,row)=>{
      await db.query("UPDATE public.connectwise_connections SET status='cleanup_required',public_secret_ref=NULL,private_secret_ref=NULL,updated_at=clock_timestamp() WHERE account_id=$1 AND id=$2",[context.accountId,row.id]);return row.id;
    });
  }
  async activeId(context:CustomerContext) {
    const result=await this.pool.query<{id:string|null}>(`SELECT c.id FROM public.accounts a LEFT JOIN public.connectwise_connections c ON c.account_id=a.id AND c.status='connected' ${ownership}`,[context.accountId,context.userId]);
    if(result.rows.length!==1)throw new ConnectionError("storage_unavailable",503);return result.rows[0].id;
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
