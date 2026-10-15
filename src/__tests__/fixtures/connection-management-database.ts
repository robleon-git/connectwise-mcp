import {randomUUID} from 'node:crypto';
import {expect,vi} from 'vitest';
import type {Pool} from 'pg';
import {CustomerStore} from '../../control-plane/auth/store.js';
import {ConnectionStore} from '../../connections/store.js';
import {ConnectionService} from '../../connections/service.js';
import {ConnectionError} from '../../connections/errors.js';
import {CUSTOMER_VAULT_URI,secretNames} from '../../connections/vault.js';
import {AccountAccessStore,createCustomerConfigProvider} from '../../auth/customer-access.js';
export async function verifyConnectionManagementDatabase(control:Pool,mcp:Pool,migrator:Pool) {
 const customers=new CustomerStore(control),store=new ConnectionStore(control);
 const identity={tenantId:randomUUID(),objectId:randomUUID()};
 const a=(await customers.login(identity)).context,b=(await customers.login({...identity,objectId:randomUUID()})).context;
 const input={url:'https://custom.customer.example.com/v4_6_release/apis/3.0',companyId:'original',publicKey:'original-public',privateKey:'original-private'};
 const values=new Map<string,{publicKey:string;privateKey:string}>();
 const writer={write:vi.fn(async(id:string,publicKey:string,privateKey:string)=>{values.set(id,{publicKey,privateKey});const n=secretNames(id);return {publicRef:`${CUSTOMER_VAULT_URI}/secrets/${n.publicKey}/${'a'.repeat(32)}`,privateRef:`${CUSTOMER_VAULT_URI}/secrets/${n.privateKey}/${'b'.repeat(32)}`};}),cleanup:vi.fn(async(id:string)=>{values.delete(id);})};
 const reader={read:vi.fn(async(c:{connectionId:string})=>{const v=values.get(c.connectionId);if(!v)throw new Error();return {...v};})};
 const validate=vi.fn(async(_input:unknown)=>{}),service=new ConnectionService(store,()=>writer,validate,()=>reader);
 await service.setup(a,input);const original=(await control.query('SELECT * FROM connectwise_connections WHERE account_id=$1',[a.accountId])).rows[0];
 const saved=await service.status(a);expect(saved).toMatchObject({serverUrl:input.url,companyId:'original'});expect(JSON.stringify(saved)).not.toMatch(/original-public|original-private|vault|secret/);
 const row=()=>control.query('SELECT * FROM connectwise_connections WHERE account_id=$1',[a.accountId]).then(r=>r.rows[0]);
 writer.write.mockClear();writer.cleanup.mockClear();await expect(service.test(a)).resolves.toEqual({status:'successful'});expect(await row()).toEqual(original);expect(writer.write).not.toHaveBeenCalled();expect(writer.cleanup).not.toHaveBeenCalled();
 validate.mockRejectedValueOnce(new ConnectionError('authentication_failed'));await expect(service.test(a)).rejects.toMatchObject({code:'authentication_failed'});expect(await row()).toEqual(original);
 const forged={...b,accountId:a.accountId};reader.read.mockClear();validate.mockClear();for(const action of [()=>service.test(forged),()=>service.edit(forged,{url:input.url,companyId:'other'}),()=>service.disconnect(forged)])await expect(action()).rejects.toMatchObject({code:'entitlement_required'});expect(reader.read).not.toHaveBeenCalled();expect(validate).not.toHaveBeenCalled();expect(await row()).toEqual(original);
 validate.mockRejectedValueOnce(new ConnectionError('authentication_failed'));await expect(service.edit(a,{...input,privateKey:'invalid-private'})).rejects.toMatchObject({code:'authentication_failed'});expect(await row()).toEqual(original);expect(values.has(original.id)).toBe(true);expect(writer.write).not.toHaveBeenCalled();
 writer.write.mockImplementationOnce(async(id:string)=>{values.set(id,{publicKey:'partial',privateKey:'partial'});throw new ConnectionError('storage_unavailable',503);});await expect(service.edit(a,input)).rejects.toMatchObject({code:'storage_unavailable'});expect(await row()).toEqual(original);expect(values.size).toBe(1);
 // While validation is blocked, MCP still sees the working row, and another edit/remove cannot race it.
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>{entered=r;}),gate=new Promise<void>(r=>{release=r;});
 const slow=new ConnectionService(store,()=>writer,async()=>{entered();await gate;},()=>reader);
 const editing=slow.edit(a,{url:input.url,companyId:'updated'});await started;expect(await row()).toEqual(original);await expect(service.disconnect(a)).rejects.toMatchObject({code:'setup_in_progress'});release();await editing;
 const edited=await row();expect(edited.id).not.toBe(original.id);expect(edited.company_id).toBe('updated');expect(values.get(edited.id)).toEqual({publicKey:input.publicKey,privateKey:input.privateKey});expect(values.has(original.id)).toBe(false);
 await service.edit(a,{...input,companyId:'replaced',publicKey:'replacement-public',privateKey:'replacement-private'});const replaced=await row();expect(values.get(replaced.id)).toEqual({publicKey:'replacement-public',privateKey:'replacement-private'});expect(values.has(edited.id)).toBe(false);
 // A database activation failure after deleting the old row rolls the entire replacement back.
 await migrator.query(`CREATE FUNCTION public.management_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id='${a.accountId}'::uuid THEN RAISE EXCEPTION 'synthetic_activation_failure'; END IF; RETURN NEW; END $$`);
 await migrator.query('CREATE TRIGGER management_reject_insert BEFORE INSERT ON public.connectwise_connections FOR EACH ROW EXECUTE FUNCTION public.management_reject_insert()');
 try {await expect(service.edit(a,input)).rejects.toMatchObject({code:'storage_unavailable'});expect(await row()).toEqual(replaced);expect(values.size).toBe(1);expect(values.has(replaced.id)).toBe(true);}
 finally {await migrator.query('DROP TRIGGER management_reject_insert ON public.connectwise_connections; DROP FUNCTION public.management_reject_insert()');}
 // Revocation between successful validation and persistence prevents a vault write.
 const beforeWrites=writer.write.mock.calls.length;
 const revoking=new ConnectionService(store,()=>writer,async()=>{await migrator.query("UPDATE entitlements SET status='suspended' WHERE account_id=$1",[a.accountId]);},()=>reader);
 await expect(revoking.edit(a,input)).rejects.toMatchObject({code:'entitlement_required'});expect(writer.write.mock.calls.length).toBe(beforeWrites);expect(await row()).toEqual(replaced);
 await migrator.query("UPDATE entitlements SET status='active' WHERE account_id=$1",[a.accountId]);
 const duringWrite={...writer,write:async(id:string,pub:string,priv:string)=>{const refs=await writer.write(id,pub,priv);await migrator.query("UPDATE entitlements SET status='suspended' WHERE account_id=$1",[a.accountId]);return refs;}};
 await expect(new ConnectionService(store,()=>duringWrite,validate,()=>reader).edit(a,input)).rejects.toMatchObject({code:'entitlement_required'});expect(await row()).toEqual(replaced);expect(values.size).toBe(1);
 await migrator.query("UPDATE entitlements SET status='active' WHERE account_id=$1",[a.accountId]);
 const issuer='https://identity.example/management',principal={issuer,subject:'management-owner'};
 await control.query('INSERT INTO external_mcp_identities(issuer,subject,user_id) VALUES($1,$2,$3)',[issuer,principal.subject,a.userId]);
 await control.query("INSERT INTO account_billing(account_id,stripe_customer_id,stripe_price_id) VALUES($1,'cus_managementfixture','price_managementfixture')",[a.accountId]);
 const snapshot=()=>control.query(`SELECT (SELECT row_to_json(a) FROM accounts a WHERE id=$1) account,(SELECT json_agg(e ORDER BY id) FROM entitlements e WHERE account_id=$1) entitlements,(SELECT row_to_json(b) FROM account_billing b WHERE account_id=$1) billing,(SELECT json_agg(x) FROM external_mcp_identities x WHERE user_id=$2) bindings`,[a.accountId,a.userId]).then(r=>r.rows);
 const before=await snapshot();const config=createCustomerConfigProvider(new AccountAccessStore(mcp,issuer),reader);await expect(config(principal)).resolves.toMatchObject({companyId:'replaced'});
 await service.disconnect(a);expect(await service.status(a)).toEqual({status:'not_configured'});expect((await row()).status).toBe('cleanup_required');expect((await row()).public_secret_ref).toBe(null);expect(values.size).toBe(0);expect(await snapshot()).toEqual(before);
 reader.read.mockClear();await expect(config(principal)).rejects.toMatchObject({code:'setup_required'});expect(reader.read).not.toHaveBeenCalled();
 // A failed vault cleanup cannot reactivate the disconnected row, and setup can reclaim its durable locator.
 await service.setup(a,input);const cleanupFails={...writer,cleanup:vi.fn(async()=>{throw new Error('synthetic-private');})};const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{await new ConnectionService(store,()=>cleanupFails,validate,()=>reader).disconnect(a);expect((await row()).status).toBe('cleanup_required');expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private');await expect(config(principal)).rejects.toMatchObject({code:'setup_required'});}finally{log.mockRestore();}
 await service.setup(a,input);expect((await service.status(a)).status).toBe('connected');
 await migrator.query("UPDATE entitlements SET starts_at=now()-interval '32 days',ends_at=now()-interval '1 day' WHERE account_id=$1",[a.accountId]);reader.read.mockClear();await expect(service.test(a)).rejects.toMatchObject({code:'entitlement_required'});expect(reader.read).not.toHaveBeenCalled();await service.disconnect(a);expect((await service.status(a)).status).toBe('not_configured');
}
