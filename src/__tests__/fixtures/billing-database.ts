import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CustomerStore } from "../../control-plane/auth/store.js";
import { BillingStore } from "../../billing/store.js";
import { BillingService } from "../../billing/service.js";
import type { BillingConfig } from "../../billing/config.js";
import { BillingError } from "../../billing/config.js";
import type { SubscriptionState } from "../../billing/model.js";
import { ACCOUNT_ENTITLEMENTS_SQL,evaluateEntitlements } from "../../entitlements/service.js";
/** Disposable PostgreSQL fixtures only; no real Stripe or production commercial state. */
export async function verifyBillingDatabase(control:Pool,mcp:Pool,migrator:Pool){
 const owner=(await new CustomerStore(control).login({tenantId:randomUUID(),objectId:randomUUID(),name:"Synthetic billing fixture"})).context;
 const config:BillingConfig={mode:"test",stripeAccountId:"acct_fixture",productId:"prod_fixture",priceId:"price_fixture",portalConfigurationId:"bpc_fixture",secretKey:"sk_test_syntheticFixtureOnly",webhookSecret:"whsec_syntheticFixtureOnly"};
 const store=new BillingStore(control);await store.mapCustomer(owner,"cus_billing",config.priceId);await store.bindSubscription(owner,"cus_billing","sub_billing");
 await expect(control.query("INSERT INTO public.account_billing(account_id,stripe_customer_id,stripe_price_id) VALUES($1,'cus_other','price_fixture')",[owner.accountId])).rejects.toMatchObject({code:"23505"});
 const now=new Date(),start=new Date(now.getTime()-86400000),end=new Date(now.getTime()+86400000);
 let current:SubscriptionState={id:"sub_billing",customer:"cus_billing",accountId:owner.accountId,price:config.priceId,status:"active",periodStart:start,periodEnd:end,cancelAt:null,paidInvoice:true,pausedCollection:false};
 const provider={createCustomer:async()=>"cus_billing",verifyCustomer:async()=>{},subscription:async()=>current,verifyWebhook:()=>{throw Error("unused");}};
 const service=new BillingService(config,store,provider);let serial=0;
 const event=async(hint:string|null=owner.accountId,subscription="sub_billing")=>{const id="evt_billing"+(serial++);await store.receive({id,type:"customer.subscription.updated",created:now,customer:"cus_billing",subscription,accountHint:hint});return id;};
 const grants=async()=>(await control.query(ACCOUNT_ENTITLEMENTS_SQL,[owner.accountId])).rows;
 const independent=(await control.query("SELECT row_to_json(e) AS row FROM public.entitlements e WHERE account_id=$1 AND source='trial'",[owner.accountId])).rows[0].row;
 const id=await event();expect(await service.process(id)).toEqual({applied:true});expect(await service.process(id)).toEqual({applied:false});expect((await grants()).filter(x=>x.source==='web_paid')).toHaveLength(1);
 current={...current,status:"past_due",paidInvoice:false};await service.process(await event());expect((await grants()).find(x=>x.source==='web_paid').status).toBe("active");
 current={...current,status:"canceled"};await service.process(await event());expect((await grants()).find(x=>x.source==='web_paid').status).toBe("canceled");expect(evaluateEntitlements(await grants()).allowed).toBe(true);
 for(const source of ["comp","substack"]){await control.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,$3,'active',$4,NULL)",[randomUUID(),owner.accountId,source,start]);expect(evaluateEntitlements(await grants()).allowed).toBe(true);}
 const independentBefore=(await control.query("SELECT row_to_json(e) AS row FROM public.entitlements e WHERE account_id=$1 AND source<>'web_paid' ORDER BY source",[owner.accountId])).rows;
 current={...current,status:"active",paidInvoice:true};await service.process(await event());expect((await grants()).find(x=>x.source==='web_paid').status).toBe("active");expect((await grants()).filter(x=>x.source==='web_paid')).toHaveLength(1);
 expect((await control.query("SELECT row_to_json(e) AS row FROM public.entitlements e WHERE account_id=$1 AND source='trial'",[owner.accountId])).rows[0].row).toEqual(independent);
 expect((await control.query("SELECT row_to_json(e) AS row FROM public.entitlements e WHERE account_id=$1 AND source<>'web_paid' ORDER BY source",[owner.accountId])).rows).toEqual(independentBefore);
 const wrong=await event(randomUUID());expect(await service.process(wrong)).toEqual({applied:false});expect((await control.query("SELECT processing_status FROM public.billing_events WHERE stripe_event_id=$1",[wrong])).rows[0].processing_status).toBe("quarantined");
 const olderSub=await event(owner.accountId,"sub_superseded");expect(await service.process(olderSub)).toEqual({applied:false});
 const first=await event(),second=await event();const c=await store.claim(first);expect(c).not.toBeNull();expect(await store.claim(second)).toBeNull();
 await migrator.query("UPDATE public.account_billing SET lease_expires_at=now()-interval '1 second' WHERE account_id=$1",[owner.accountId]);await migrator.query("UPDATE public.billing_events SET lease_expires_at=now()-interval '1 second' WHERE stripe_event_id=$1",[first]);
 const newer=await store.claim(second);expect(newer).not.toBeNull();await expect(store.finish(c!,{status:"canceled",action:"cancel",paid:true,periodStart:start,periodEnd:end,endsAt:null})).rejects.toThrow();await store.finish(newer!,{status:"active",action:"activate",paid:true,periodStart:start,periodEnd:end,endsAt:null});expect((await grants()).find(x=>x.source==='web_paid').status).toBe("active");
 await store.fail(c!,"lost_lease"); // Cannot release another worker's lease or alter processed receipt.
 current={...current,pausedCollection:true};const review=await event();await expect(service.process(review)).rejects.toThrow("policy_review_required");expect((await control.query("SELECT processing_status FROM public.billing_events WHERE stripe_event_id=$1",[review])).rows[0].processing_status).toBe("quarantined");
 const failed=await event();provider.subscription=async()=>{throw new BillingError("billing_unavailable");};await expect(service.process(failed)).rejects.toThrow("billing_unavailable");expect((await control.query("SELECT processing_status,detail_category FROM public.billing_events WHERE stripe_event_id=$1",[failed])).rows[0]).toEqual({processing_status:"retry",detail_category:"billing_unavailable"});
 for(const q of ["UPDATE public.entitlements SET status='canceled'","DELETE FROM public.entitlements","DELETE FROM public.account_billing","UPDATE public.account_billing SET stripe_customer_id='cus_swap'","UPDATE public.account_billing SET stripe_price_id='price_swap'"])await expect(control.query(q)).rejects.toThrow();
 for(const q of ["SELECT * FROM public.account_billing","SELECT * FROM public.billing_events","SELECT public.apply_test_stripe_projection(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)"])await expect(mcp.query(q)).rejects.toThrow();
 const f=(await migrator.query("SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) AS owner,has_function_privilege('cw_mcp',p.oid,'EXECUTE') AS mcp_execute FROM pg_proc p WHERE proname='apply_test_stripe_projection'")).rows[0];expect(f).toMatchObject({prosecdef:true,proconfig:["search_path=pg_catalog"],owner:"cw_migrator",mcp_execute:false});
 expect((await migrator.query("SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.proname='apply_test_stripe_projection' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'")).rows[0].n).toBe(0);
 // A failed receipt commit rolls back the preceding restricted entitlement/projection write as one transaction.
 const atomicId=await event();provider.subscription=async()=>({...current,status:"canceled",pausedCollection:false});
 await migrator.query("CREATE FUNCTION public.billing_fixture_commit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_fixture_failure'; END $$; CREATE TRIGGER billing_fixture_fail BEFORE UPDATE ON public.billing_events FOR EACH ROW WHEN (NEW.processing_status='processed') EXECUTE FUNCTION public.billing_fixture_commit_failure()");
 const paidBefore=(await control.query("SELECT row_to_json(e) AS row FROM public.entitlements e WHERE account_id=$1 AND source='web_paid'",[owner.accountId])).rows;
 try {await expect(service.process(atomicId)).rejects.toThrow("billing_unavailable");expect((await control.query("SELECT row_to_json(e) AS row FROM public.entitlements e WHERE account_id=$1 AND source='web_paid'",[owner.accountId])).rows).toEqual(paidBefore);}
 finally {await migrator.query("DROP TRIGGER billing_fixture_fail ON public.billing_events; DROP FUNCTION public.billing_fixture_commit_failure()");}
 const priv=(await migrator.query("SELECT has_table_privilege('cw_control','public.entitlements','UPDATE') AS update,has_table_privilege('cw_control','public.entitlements','DELETE') AS delete,has_table_privilege('cw_mcp','public.billing_events','SELECT') AS billing_read")).rows[0];expect(priv).toEqual({update:false,delete:false,billing_read:false});
 await expect(control.query("SELECT public.apply_test_stripe_projection($1,'cus_billing','sub_billing','price_fixture',NULL,0,'active','activate',true,$2,$3,NULL)",[owner.accountId,start,end])).rejects.toThrow();
 expect((await migrator.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='billing_events' AND column_name IN ('payload','raw_body','card','email')")).rows[0].n).toBe(0);
}
