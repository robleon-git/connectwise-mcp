import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BillingError } from "./config.js";
import { BILLING_EVENTS, providerId, type BillingOwner, type Mapping, type Projection, type Receipt, type CheckoutReservation, type CheckoutSnapshot } from "./model.js";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
interface MappingRow { account_id: string; stripe_customer_id: string; stripe_subscription_id: string | null; stripe_price_id: string; paid_activation_confirmed: boolean; subscription_status: string | null; version: string }
const mapping = (b: MappingRow): Mapping => ({ accountId: b.account_id, customer: b.stripe_customer_id, subscription: b.stripe_subscription_id, price: b.stripe_price_id, paid: b.paid_activation_confirmed, status: b.subscription_status });
export interface Claim { receipt: Receipt; mapping: Mapping; lease: string; version: string }
/** Private TEST billing store with short transactions and lease-fenced entitlement projection. */
export class BillingStore {
  constructor(private readonly pool: Pick<Pool, "query" | "connect">) {}
  async owned(owner: BillingOwner): Promise<Mapping | null> {
    if (!UUID.test(owner.userId) || !UUID.test(owner.accountId)) throw new BillingError("invalid_mapping");
    try {
      const r = await this.pool.query<MappingRow>(`SELECT b.* FROM public.account_memberships m JOIN public.users u ON u.id=m.user_id JOIN public.accounts a ON a.id=m.account_id LEFT JOIN public.account_billing b ON b.account_id=a.id WHERE m.user_id=$1 AND m.account_id=$2 AND m.role='owner' AND u.status='active' AND a.status='active'`, [owner.userId, owner.accountId]);
      if (r.rows.length !== 1) throw new BillingError("invalid_mapping");
      return r.rows[0].stripe_customer_id ? mapping(r.rows[0]) : null;
    } catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  async mapCustomer(owner: BillingOwner, customer: string, price: string) {
    await this.owned(owner); providerId(customer, "cus"); providerId(price, "price");
    try {
      // Ownership rechecked at write time. Concurrent calls reuse the provider's deterministic idempotency key.
      await this.pool.query(`INSERT INTO public.account_billing(account_id,stripe_customer_id,stripe_price_id)
        SELECT a.id,$3,$4 FROM public.accounts a JOIN public.account_memberships m ON m.account_id=a.id JOIN public.users u ON u.id=m.user_id
        WHERE a.id=$1 AND m.user_id=$2 AND a.status='active' AND u.status='active' AND m.role='owner' ON CONFLICT(account_id) DO NOTHING`, [owner.accountId,owner.userId,customer,price]);
      const b = await this.owned(owner); if (!b || b.customer !== customer || b.price !== price) throw new BillingError("invalid_mapping"); return b;
    } catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  async bindSubscription(owner: BillingOwner, customer: string, subscription: string) {
    await this.owned(owner); providerId(subscription, "sub");
    try {
      const r = await this.pool.query(`UPDATE public.account_billing b SET stripe_subscription_id=$3,subscription_status=NULL,paid_activation_confirmed=false,version=version+1,updated_at=statement_timestamp()
        WHERE b.account_id=$1 AND b.stripe_customer_id=$2 AND (b.lease_token IS NULL OR b.lease_expires_at<=statement_timestamp())
        AND (b.stripe_subscription_id IS NULL OR b.subscription_status IN ('canceled','unpaid','incomplete_expired'))
        AND EXISTS(SELECT 1 FROM public.account_memberships m JOIN public.users u ON u.id=m.user_id JOIN public.accounts a ON a.id=m.account_id WHERE m.account_id=b.account_id AND m.user_id=$4 AND m.role='owner' AND u.status='active' AND a.status='active')`, [owner.accountId,customer,subscription,owner.userId]);
      if (r.rowCount !== 1) throw new BillingError("invalid_mapping");
    } catch (e) { if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
  }
  async receive(e: Receipt) {
    try {
      const supported = BILLING_EVENTS.some(t => t === e.type);
      const r = await this.pool.query(`INSERT INTO public.billing_events(stripe_event_id,event_type,event_created_at,stripe_customer_id,stripe_subscription_id,account_hint,processing_status,detail_category,stripe_checkout_session_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(stripe_event_id) DO NOTHING`, [e.id,e.type,e.created,e.customer,e.subscription,e.accountHint,supported ? "received" : "ignored",supported ? null : "unsupported_event",e.checkoutSession ?? null]);
      return { recorded: r.rowCount === 1, duplicate: r.rowCount === 0 };
    } catch { throw new BillingError("billing_unavailable"); }
  }
  private async transaction<T>(work: (db: PoolClient) => Promise<T>): Promise<T> {
    let db: PoolClient;
    try { db = await this.pool.connect(); } catch { throw new BillingError("billing_unavailable"); }
    try { await db.query("BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'"); const value = await work(db); await db.query("COMMIT"); return value; }
    catch (e) { await db.query("ROLLBACK").catch(() => {}); if (e instanceof BillingError) throw e; throw new BillingError("billing_unavailable"); }
    finally { db.release(); }
  }
  async claim(id: string): Promise<Claim | null> {
    return this.transaction(async db => {
      const r = await db.query<{ stripe_event_id: string; event_type: string; event_created_at: Date; stripe_customer_id: string | null; stripe_subscription_id: string | null; account_hint: string | null }>(`SELECT * FROM public.billing_events WHERE stripe_event_id=$1 AND processing_status IN ('received','retry','processing') AND next_attempt_at<=statement_timestamp() AND (lease_token IS NULL OR lease_expires_at<=statement_timestamp()) FOR UPDATE SKIP LOCKED`, [id]);
      if (!r.rows.length) return null;
      const e = r.rows[0];
      const b = await db.query<MappingRow>(`SELECT * FROM public.account_billing WHERE stripe_customer_id=$1 FOR UPDATE`, [e.stripe_customer_id]);
      if (b.rows.length !== 1 || !e.stripe_subscription_id || b.rows[0].stripe_subscription_id !== e.stripe_subscription_id || e.account_hint !== null && e.account_hint !== b.rows[0].account_id) {
        await db.query("UPDATE public.billing_events SET processing_status='quarantined',detail_category='invalid_mapping',processed_at=statement_timestamp() WHERE stripe_event_id=$1", [id]); return null;
      }
      const lease = randomUUID();
      const got = await db.query(`UPDATE public.account_billing SET lease_token=$2,lease_expires_at=statement_timestamp()+interval '60 seconds' WHERE account_id=$1 AND (lease_token IS NULL OR lease_expires_at<=statement_timestamp())`, [b.rows[0].account_id,lease]);
      if (got.rowCount !== 1) return null;
      await db.query(`UPDATE public.billing_events SET account_id=$2,processing_status='processing',attempts=attempts+1,lease_token=$3,lease_expires_at=statement_timestamp()+interval '60 seconds' WHERE stripe_event_id=$1`, [id,b.rows[0].account_id,lease]);
      return { receipt: { id:e.stripe_event_id,type:e.event_type,created:e.event_created_at,customer:e.stripe_customer_id,subscription:e.stripe_subscription_id,accountHint:e.account_hint }, mapping: mapping(b.rows[0]), lease, version: b.rows[0].version };
    });
  }
  async finish(c: Claim, p: Projection) {
    return this.transaction(async db => {
      const event = await db.query(`SELECT stripe_event_id FROM public.billing_events WHERE stripe_event_id=$1 AND lease_token=$2 AND lease_expires_at>statement_timestamp() AND processing_status='processing' FOR UPDATE`, [c.receipt.id,c.lease]);
      if (event.rows.length !== 1) throw new BillingError("lost_lease");
      await db.query("SELECT public.apply_test_stripe_projection($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [c.mapping.accountId,c.mapping.customer,c.mapping.subscription,c.mapping.price,c.lease,c.version,p.status,p.action,p.paid,p.periodStart,p.periodEnd,p.endsAt]);
      const done = await db.query("UPDATE public.billing_events SET processing_status='processed',processed_at=statement_timestamp(),lease_token=NULL,lease_expires_at=NULL,detail_category=NULL WHERE stripe_event_id=$1 AND lease_token=$2", [c.receipt.id,c.lease]); if (done.rowCount !== 1) throw new BillingError("lost_lease");
    });
  }
  async fail(c: Claim, category: BillingError["category"]) {
    return this.transaction(async db => {
      const quarantine = ["invalid_mapping","invalid_subscription","policy_review_required"].includes(category);
      await db.query(`UPDATE public.billing_events SET processing_status=$3,detail_category=$4,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=statement_timestamp()+interval '1 minute' WHERE stripe_event_id=$1 AND lease_token=$2`, [c.receipt.id,c.lease,quarantine ? "quarantined" : "retry",category]);
      await db.query("UPDATE public.account_billing SET lease_token=NULL,lease_expires_at=NULL WHERE account_id=$1 AND lease_token=$2", [c.mapping.accountId,c.lease]);
    });
  }
  async pending(limit = 25): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new BillingError("invalid_configuration");
    try { return (await this.pool.query<{ stripe_event_id: string }>("SELECT stripe_event_id FROM public.billing_events WHERE processing_status IN ('received','retry','processing') AND next_attempt_at<=statement_timestamp() AND (lease_token IS NULL OR lease_expires_at<=statement_timestamp()) ORDER BY received_at LIMIT $1", [limit])).rows.map(x => x.stripe_event_id); }
    catch { throw new BillingError("billing_unavailable"); }
  }
  async checkoutReservation(accountId: string, session?: string): Promise<CheckoutReservation | null> {
    try {
      const r=await this.pool.query<{id:string;account_id:string;stripe_customer_id:string;stripe_price_id:string;stripe_session_id:string|null;expires_at:Date;status:CheckoutReservation["status"]}>(`SELECT * FROM public.billing_checkouts WHERE account_id=$1 AND ${session ? "stripe_session_id=$2" : "status IN ('reserved','open','uncertain')"} ORDER BY created_at DESC LIMIT 1`,session?[accountId,session]:[accountId]);
      const c=r.rows[0];return c?{id:c.id,accountId:c.account_id,customer:c.stripe_customer_id,price:c.stripe_price_id,session:c.stripe_session_id,expiresAt:c.expires_at,status:c.status}:null;
    } catch {throw new BillingError("billing_unavailable");}
  }
  async reserveCheckout(owner: BillingOwner): Promise<CheckoutReservation> {
    return this.transaction(async db=>{
      const b=await db.query<MappingRow>(`SELECT b.* FROM public.account_billing b JOIN public.account_memberships m ON m.account_id=b.account_id JOIN public.accounts a ON a.id=m.account_id JOIN public.users u ON u.id=m.user_id WHERE b.account_id=$1 AND m.user_id=$2 AND m.role='owner' AND a.status='active' AND u.status='active' FOR UPDATE OF b`,[owner.accountId,owner.userId]);
      if(b.rows.length!==1)throw new BillingError("invalid_mapping");
      if(b.rows[0].stripe_subscription_id && !["canceled","unpaid","incomplete_expired"].includes(b.rows[0].subscription_status??""))throw new BillingError("checkout_pending");
      const existing=await db.query<{id:string}>("SELECT id FROM public.billing_checkouts WHERE account_id=$1 AND status IN ('reserved','open','uncertain')",[owner.accountId]);
      if(existing.rows.length===0)await db.query("INSERT INTO public.billing_checkouts(id,account_id,stripe_customer_id,stripe_price_id,status,expires_at) VALUES($1,$2,$3,$4,'reserved',date_trunc('second',statement_timestamp())+interval '1 hour')",[randomUUID(),owner.accountId,b.rows[0].stripe_customer_id,b.rows[0].stripe_price_id]);
      const r=await db.query<{id:string;stripe_customer_id:string;stripe_price_id:string;stripe_session_id:string|null;expires_at:Date;status:CheckoutReservation["status"]}>("SELECT * FROM public.billing_checkouts WHERE account_id=$1 AND status IN ('reserved','open','uncertain')",[owner.accountId]);const c=r.rows[0];
      return {id:c.id,accountId:owner.accountId,customer:c.stripe_customer_id,price:c.stripe_price_id,session:c.stripe_session_id,expiresAt:c.expires_at,status:c.status};
    });
  }
  async saveCheckout(r: CheckoutReservation,s: CheckoutSnapshot) {
    if(s.id!==r.session && r.session!==null || s.customer!==r.customer || s.accountId!==r.accountId || s.reservationId!==r.id || s.price!==r.price || s.expiresAt.getTime()!==r.expiresAt.getTime())throw new BillingError("invalid_mapping");
    try {const got=await this.pool.query("UPDATE public.billing_checkouts SET stripe_session_id=$2,status=$3 WHERE id=$1 AND status IN ('reserved','open','uncertain') AND (stripe_session_id IS NULL OR stripe_session_id=$2)",[r.id,s.id,s.status==='complete'?'open':s.status]);if(got.rowCount!==1)throw new BillingError("checkout_pending");}
    catch(e){if(e instanceof BillingError)throw e;throw new BillingError("billing_unavailable");}
  }
  async uncertainCheckout(id:string) {try{await this.pool.query("UPDATE public.billing_checkouts SET status='uncertain' WHERE id=$1 AND status='reserved'",[id]);}catch{throw new BillingError("billing_unavailable");}}
  async association(id:string):Promise<{receipt:Receipt;mapping:Mapping}|null> {
    try {const e=(await this.pool.query<{stripe_event_id:string;event_type:string;event_created_at:Date;stripe_customer_id:string|null;stripe_subscription_id:string|null;account_hint:string|null;stripe_checkout_session_id:string|null}>("SELECT * FROM public.billing_events WHERE stripe_event_id=$1 AND processing_status IN ('received','retry','processing') AND (lease_token IS NULL OR lease_expires_at<=statement_timestamp())",[id])).rows[0];if(!e)return null;
      const b=(await this.pool.query<MappingRow>("SELECT * FROM public.account_billing WHERE stripe_customer_id=$1",[e.stripe_customer_id])).rows[0];if(!b)return null;
      return {receipt:{id:e.stripe_event_id,type:e.event_type,created:e.event_created_at,customer:e.stripe_customer_id,subscription:e.stripe_subscription_id,accountHint:e.account_hint,checkoutSession:e.stripe_checkout_session_id},mapping:mapping(b)};
    }catch{throw new BillingError("billing_unavailable");}
  }
  async deferAssociation(id:string,invalid=false) {try{await this.pool.query("UPDATE public.billing_events SET processing_status=$2,detail_category=$3,next_attempt_at=statement_timestamp()+interval '1 minute' WHERE stripe_event_id=$1 AND processing_status IN ('received','retry')",[id,invalid?'quarantined':'retry',invalid?'invalid_mapping':'checkout_pending']);}catch{throw new BillingError("billing_unavailable");}}
  async confirmCheckout(r:CheckoutReservation,s:CheckoutSnapshot) {
    if(s.status!=="complete" || !s.subscription || s.customer!==r.customer || s.accountId!==r.accountId || s.reservationId!==r.id || s.price!==r.price || s.id!==r.session)throw new BillingError("invalid_mapping");providerId(s.subscription,"sub");
    return this.transaction(async db=>{
      const b=(await db.query<MappingRow>("SELECT * FROM public.account_billing WHERE account_id=$1 FOR UPDATE",[r.accountId])).rows[0];const c=(await db.query<{status:string;stripe_session_id:string;stripe_customer_id:string;stripe_price_id:string}>("SELECT * FROM public.billing_checkouts WHERE id=$1 AND account_id=$2 FOR UPDATE",[r.id,r.accountId])).rows[0];
      if(!b||!c||c.stripe_session_id!==s.id||c.stripe_customer_id!==b.stripe_customer_id||c.stripe_price_id!==b.stripe_price_id)throw new BillingError("invalid_mapping");
      if(c.status==='complete'){if(b.stripe_subscription_id===s.subscription)return;throw new BillingError("invalid_mapping");}
      if(b.stripe_subscription_id && !["canceled","unpaid","incomplete_expired"].includes(b.subscription_status??""))throw new BillingError("invalid_mapping");
      const got=await db.query("UPDATE public.account_billing SET stripe_subscription_id=$2,subscription_status=NULL,paid_activation_confirmed=false,version=version+1,lease_token=NULL,lease_expires_at=NULL,updated_at=statement_timestamp() WHERE account_id=$1 AND (lease_token IS NULL OR lease_expires_at<=statement_timestamp())",[r.accountId,s.subscription]);if(got.rowCount!==1)throw new BillingError("checkout_pending");
      await db.query("UPDATE public.billing_checkouts SET status='complete' WHERE id=$1",[r.id]);
    });
  }

}
