import {randomUUID} from "node:crypto";
import {expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {CustomerStore} from '../../control-plane/auth/store.js';
import {ConnectionStore} from '../../connections/store.js';
import {ConnectionService} from '../../connections/service.js';
import {ConnectionError} from '../../connections/errors.js';
import {CUSTOMER_VAULT_URI,secretNames} from '../../connections/vault.js';
export async function verifyConnectionDatabase(runtime:Pool,migrator:Pool) {
 const customers=new CustomerStore(runtime);
 const identity={tenantId:'22222222-2222-4222-8222-222222222222',objectId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
 const a=(await customers.login(identity)).context;
 const b=(await customers.login({...identity,objectId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})).context;
 const store=new ConnectionStore(runtime);
 const keys=new Map<string,string>();
 const writer={write:vi.fn(async(id:string,pub:string,priv:string)=>{const names=secretNames(id);keys.set(names.publicKey,pub);keys.set(names.privateKey,priv);return{publicRef:`${CUSTOMER_VAULT_URI}/secrets/${names.publicKey}/${'a'.repeat(32)}`,privateRef:`${CUSTOMER_VAULT_URI}/secrets/${names.privateKey}/${'b'.repeat(32)}`};}),cleanup:vi.fn(async(id:string)=>{const names=secretNames(id);keys.delete(names.publicKey);keys.delete(names.privateKey);})};
 const input={url:'https://manage.example.com',companyId:'synthetic',publicKey:'synthetic-public',privateKey:'synthetic-private'};
 let entered!:()=>void,unblock!:()=>void;
 const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{unblock=r;});
 const validate=vi.fn(async()=>{entered();await gate;});
 const service=new ConnectionService(store,()=>writer,validate);
 const first=service.setup(a,input);await started;
 await expect(service.setup(a,input)).rejects.toMatchObject({code:'setup_in_progress'});
 expect(validate).toHaveBeenCalledTimes(1);unblock();await expect(first).resolves.toEqual({status:'connected'});
 expect(writer.write).toHaveBeenCalledTimes(1);
 expect(await store.status(a)).toEqual({status:'connected',host:'manage.example.com',serverUrl:'https://manage.example.com',companyId:'synthetic'});
 expect(await store.status(b)).toEqual({status:'not_configured'});
 await expect(store.status({...b,accountId:a.accountId})).rejects.toMatchObject({code:'entitlement_required'});
 await expect(service.setup(a,input)).rejects.toMatchObject({code:'already_configured'});
 const active=(await runtime.query('SELECT * FROM public.connectwise_connections WHERE account_id=$1',[a.accountId])).rows[0];
 expect(JSON.stringify(active)).not.toContain(input.publicKey);expect(JSON.stringify(active)).not.toContain(input.privateKey);
 await expect(runtime.query('UPDATE public.connectwise_connections SET company_id=$1 WHERE id=$2',['changed',active.id])).rejects.toThrow();
 await expect(runtime.query("INSERT INTO public.connectwise_connections(id,account_id,server_url,company_id,status,validated_at) VALUES(gen_random_uuid(),$1,'https://manage.example.com','synthetic','persisting',now())",[a.accountId])).rejects.toThrow();
 await expect(migrator.query("UPDATE public.connectwise_connections SET private_secret_ref='raw-key' WHERE id=$1",[active.id])).rejects.toThrow();
 expect(await store.cleanupState(a,active.id)).toMatchObject({status:'connected'});expect(keys.size).toBe(2);
 const normalValidate=vi.fn(async()=>{}),factory=vi.fn(()=>writer);
 const separate=new ConnectionService(store,factory,normalValidate);
 await migrator.query("UPDATE public.entitlements SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 day' WHERE account_id=$1",[b.accountId]);
 await expect(separate.setup(b,input)).rejects.toMatchObject({code:'entitlement_required'});expect(factory).not.toHaveBeenCalled();expect(normalValidate).not.toHaveBeenCalled();
 await runtime.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,'web_paid','active',now(),NULL)",[randomUUID(),b.accountId]);
 expect((await customers.status(b)).entitlement).toMatchObject({allowed:true,accessKind:"standard",trial:{status:"expired"}});
 writer.write.mockImplementationOnce(async(id:string)=>{keys.set(secretNames(id).publicKey,input.publicKey);throw new ConnectionError('storage_unavailable',503);});
 await expect(separate.setup(b,input)).rejects.toMatchObject({code:'storage_unavailable'});
 expect((await runtime.query('SELECT id FROM public.connectwise_connections WHERE account_id=$1',[b.accountId])).rows).toHaveLength(0);
 expect(keys.size).toBe(2);
 await expect(runtime.query("INSERT INTO public.connectwise_connections(id,account_id,server_url,company_id,status,validated_at) VALUES(gen_random_uuid(),'ffffffff-ffff-4fff-8fff-ffffffffffff','https://manage.example.com','synthetic','persisting',now())")).rejects.toThrow();
 await expect(separate.setup(b,input)).resolves.toEqual({status:'connected'});
 expect((await runtime.query("SELECT count(*) AS n FROM public.connectwise_connections WHERE status='connected'")).rows[0].n).toBe('2');
 // Entitlement expiry between validation and persistence must prevent even a reservation/Vault operation.
 const c=(await customers.login({...identity,objectId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'})).context;
 const expiredWriter=vi.fn(()=>writer);
 const expiring=new ConnectionService(store,expiredWriter,async()=>{await migrator.query("UPDATE public.entitlements SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 day' WHERE account_id=$1",[c.accountId]);});
 await expect(expiring.setup(c,input)).rejects.toMatchObject({code:'entitlement_required'});expect(expiredWriter).not.toHaveBeenCalled();
 expect((await runtime.query('SELECT id FROM public.connectwise_connections WHERE account_id=$1',[c.accountId])).rows).toHaveLength(0);
 for(const source of ['web_paid','comp','substack']) {
  const d=(await customers.login({...identity,objectId:randomUUID()})).context;
  await migrator.query("UPDATE public.entitlements SET starts_at=now()-interval '31 days',ends_at=now()-interval '1 day' WHERE account_id=$1",[d.accountId]);
  await runtime.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,$3,'active',now(),NULL)",[randomUUID(),d.accountId,source]);
  await expect(separate.setup(d,input)).resolves.toEqual({status:'connected'});
 }
 const revoked=(await customers.login({...identity,objectId:randomUUID()})).context;
 await migrator.query("UPDATE public.entitlements SET status='suspended' WHERE account_id=$1",[revoked.accountId]);
 const paidId=randomUUID();await runtime.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,'web_paid','active',now(),NULL)",[paidId,revoked.accountId]);
 const duringWrite={...writer,write:async(id:string,pub:string,priv:string)=>{const refs=await writer.write(id,pub,priv);await migrator.query("UPDATE public.entitlements SET status='canceled' WHERE id=$1",[paidId]);return refs;}};
 await expect(new ConnectionService(store,()=>duringWrite,normalValidate).setup(revoked,input)).rejects.toMatchObject({code:'entitlement_required'});
 expect((await runtime.query("SELECT id FROM public.connectwise_connections WHERE account_id=$1 AND status='connected'",[revoked.accountId])).rows).toHaveLength(0);

}
