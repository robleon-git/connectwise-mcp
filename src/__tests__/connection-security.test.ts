import { afterEach, describe,expect,it,vi } from "vitest";
import {normalizeTarget,pinnedLookup,publicAddress} from "../security/outbound-target.js";
import {GLOBAL_CLIENT_ID,runValidation,type ConnectionInput} from "../connections/validation-transport.js";
import type {Resolver} from "../security/outbound-target.js";
import type {fetch as undiciFetch} from "undici";
async function validateConnection(input:ConnectionInput,resolve?:Resolver,send?:typeof undiciFetch){
  return runValidation(input,async(client,transport)=>{vi.stubGlobal("fetch",transport);try{await client.get("/system/info");}finally{vi.unstubAllGlobals();}},resolve,send);
}
import {connectionInput,ConnectionService} from "../connections/service.js";
import type {ConnectionStore} from "../connections/store.js";
import {CUSTOMER_VAULT_URI,deleteOnly,secretNames,vaultWriter,validReference,type VaultClient} from "../connections/vault.js";
import {ConnectionError} from "../connections/errors.js";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const fields={url:"https://manage.example.com",companyId:"synthetic-company",publicKey:"synthetic-public",privateKey:"synthetic-private"};
const input=connectionInput(fields),context={userId:"synthetic-user",accountId:"synthetic-account",name:null};
const refs={publicRef:`${CUSTOMER_VAULT_URI}/secrets/${secretNames(id).publicKey}/${"a".repeat(32)}`,privateRef:`${CUSTOMER_VAULT_URI}/secrets/${secretNames(id).privateKey}/${"b".repeat(32)}`};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("public HTTPS destination boundary",()=>{
 it.each(["http://manage.example.com","https://u:p@manage.example.com","https://manage.example.com/#x","https://manage.example.com/?x=y","https://manage.example.com:8443","https://manage.example.com/path","https://manage.example.com\\@127.0.0.1"])("rejects malformed/noncanonical target %s",url=>expect(()=>normalizeTarget(url)).toThrow());
 it.each(["localhost","localhost.local","manage.internal","a.local","a.lan","a.test","127.0.0.1","127.9.8.7","2130706433","0x7f000001","10.0.0.1","172.16.1.1","192.168.1.1","169.254.169.254","168.63.129.16","100.64.1.1","0.0.0.0","224.1.1.1","[::1]","[::ffff:127.0.0.1]","[fc00::1]","[fe80::1]","[2001:db8::1]","[2002:a00:1::1]"])("blocks special destination %s",host=>expect(()=>normalizeTarget(`https://${host}`)).toThrow());
 it("normalizes cloud and public on-prem hosts through the same model",()=>{
  expect(normalizeTarget("https://api-na.myconnectwise.net/").baseUrl).toBe("https://api-na.myconnectwise.net");
  expect(normalizeTarget("https://manage.example.com/v4_6_release/apis/3.0/").baseUrl).toBe("https://manage.example.com/v4_6_release/apis/3.0");
  expect(publicAddress("8.8.8.8",4)).toBe(true);expect(publicAddress("2001:4860:4860::8888",6)).toBe(true);
 });
 it("rejects any blocked DNS answer, including mixed public/private and IPv6",async()=>{
  for(const answer of [[{address:"10.0.0.1",family:4}],[{address:"8.8.8.8",family:4},{address:"::1",family:6}],[]])
   await expect(pinnedLookup(input.hostname,async()=>answer,AbortSignal.timeout(1000))).rejects.toThrow("unsafe_destination");
 });
 it("pins resolution to the checked address without a second DNS query",async()=>{
  const resolve=vi.fn(async()=>[{address:"8.8.8.8",family:4}]);const lookup=await pinnedLookup(input.hostname,resolve,AbortSignal.timeout(1000));
  const invoke=lookup as unknown as (h:string,o:{all?:boolean},cb:(...a:unknown[])=>void)=>void;
  const cb=vi.fn();invoke(input.hostname,{},cb);expect(cb).toHaveBeenCalledWith(null,"8.8.8.8",4);
  invoke("other.example.com",{},cb);expect(cb.mock.calls[1][0]).toBeInstanceOf(Error);expect(resolve).toHaveBeenCalledOnce();
 });
 it("bounds a DNS resolution that never completes",async()=>{
  const controller=new AbortController();const pending=pinnedLookup(input.hostname,()=>new Promise(()=>{}),controller.signal);
  controller.abort();await expect(pending).rejects.toThrow("unreachable_host");
 });
});
describe("single production-auth GET validation",()=>{
 it.each([200,401,403,500])("discards body and sanitizes HTTP %s",async status=>{
  const cancel=vi.fn(async()=>{}),send=vi.fn(async(_url:string,options:RequestInit)=>{
   expect(options.method).toBe("GET");expect(options.redirect).toBe("error");
   expect(options.headers).toMatchObject({Authorization:`Basic ${Buffer.from(`${fields.companyId}+${fields.publicKey}:${fields.privateKey}`).toString("base64")}`,clientId:GLOBAL_CLIENT_ID});
   return {status,headers:new Headers({"Content-Type":"application/json"}),body:{cancel}};
  });
  const promise=validateConnection(input,async()=>[{address:"8.8.8.8",family:4}],send as never);
  if(status===200)await promise;else await expect(promise).rejects.toThrow(status===401||status===403?"authentication_failed":"connectwise_rejected");
  expect(send).toHaveBeenCalledOnce();expect(String(send.mock.calls[0][0])).toBe("https://manage.example.com/v4_6_release/apis/3.0/system/info");expect(cancel).toHaveBeenCalledOnce();
 });
 it.each(["CERT_HAS_EXPIRED","ERR_TLS_CERT_ALTNAME_INVALID","DEPTH_ZERO_SELF_SIGNED_CERT"])("sanitizes TLS failure %s",async code=>{
  const send=vi.fn(async()=>{throw Object.assign(new Error(fields.privateKey),{cause:{code}});});
  await expect(validateConnection(input,async()=>[{address:"8.8.8.8",family:4}],send as never)).rejects.toThrow(/^tls_failure$/);
 });
 it("never follows a redirect or sends a request for blocked DNS",async()=>{
  const send=vi.fn(async(_url:string,options:RequestInit)=>{expect(options.redirect).toBe("error");throw new Error("redirect to private host");});
  await expect(validateConnection(input,async()=>[{address:"10.0.0.1",family:4}],send as never)).rejects.toThrow("unsafe_destination");expect(send).not.toHaveBeenCalled();
  await expect(validateConnection(input,async()=>[{address:"8.8.8.8",family:4}],send as never)).rejects.toThrow("unreachable_host");expect(send).toHaveBeenCalledOnce();
 });
 it("rejects HTML-success responses and global TLS bypass",async()=>{
  const send=vi.fn(async()=>({status:200,headers:new Headers({"Content-Type":"text/html"}),body:{cancel:async()=>{}}}));
  await expect(validateConnection(input,async()=>[{address:"8.8.8.8",family:4}],send as never)).rejects.toThrow("connectwise_rejected");
  vi.stubEnv("NODE_TLS_REJECT_UNAUTHORIZED","0");send.mockClear();await expect(validateConnection(input,undefined,send as never)).rejects.toThrow("tls_failure");expect(send).not.toHaveBeenCalled();
 });
});
describe("customer vault write-only contract",()=>{
 function client(){const setSecret=vi.fn(async(name:string,_value:string)=>({properties:{id:`${CUSTOMER_VAULT_URI}/secrets/${name}/${"a".repeat(32)}`}}));const deleteSecret=vi.fn(async()=>{});return{setSecret,deleteSecret};}
 it("uses opaque immutable names/versioned references with no customer metadata",async()=>{
  const c=client(),r=await vaultWriter(c as unknown as VaultClient).write(id,fields.publicKey,fields.privateKey);
  expect(c.setSecret).toHaveBeenCalledTimes(2);expect(JSON.stringify(r)).not.toMatch(/synthetic-|example|company/);
  expect(validReference(id,"publicKey",r.publicRef)).toBe(true);expect(validReference(id,"privateKey",r.publicRef)).toBe(false);
  expect(()=>secretNames("foreign/url")).toThrow();
 });
 it("handles partial writes and cleanup of both names without reads/purge",async()=>{
  const c=client();c.setSecret.mockRejectedValueOnce(new Error(fields.privateKey));const writer=vaultWriter(c as unknown as VaultClient);
  await expect(writer.write(id,fields.publicKey,fields.privateKey)).rejects.toThrow(/^storage_unavailable$/);
  await writer.cleanup(id);expect(c.deleteSecret).toHaveBeenCalledTimes(2);
 });
 it("rejects unexpected secret references; cleanup tries both names on failure",async()=>{
  const c=client();c.setSecret.mockResolvedValueOnce({properties:{id:"https://cw-mcp-kv.vault.azure.net/secrets/pilot/x"}});
  await expect(vaultWriter(c as unknown as VaultClient).write(id,"synthetic-public","synthetic-private")).rejects.toThrow("storage_unavailable");
  c.deleteSecret.mockRejectedValueOnce(new Error(fields.privateKey));await expect(vaultWriter(c as unknown as VaultClient).cleanup(id)).rejects.toThrow("storage_unavailable");expect(c.deleteSecret).toHaveBeenCalledTimes(2);
 });
});
describe("activation, cleanup and sanitized diagnostics",()=>{
 function fixture(){const store={reserve:vi.fn(async()=>({id,accountId:context.accountId,baseUrl:input.baseUrl,companyId:input.companyId})),activate:vi.fn(async()=>{}),cleanupState:vi.fn(async()=>"cleanup"),removePending:vi.fn(async()=>{}),status:vi.fn()};const writer={write:vi.fn(async()=>refs),cleanup:vi.fn(async()=>{})};return{store,writer,service:new ConnectionService(store as unknown as ConnectionStore,()=>writer,vi.fn(async()=>{}))};}
 it("rejects browser account/connection IDs and clientId overrides",()=>{
  for(const extra of [{accountId:"foreign"},{connectionId:id},{clientId:"foreign"}])expect(()=>connectionInput({...fields,...extra})).toThrow("invalid_input");
  for(const key of ["publicKey","privateKey"])expect(()=>connectionInput({...fields,[key]:""})).toThrow("invalid_input");
 });
 it("denied entitlement performs zero secret writes",async()=>{const f=fixture();f.store.reserve.mockRejectedValueOnce(new ConnectionError("entitlement_required",403));await expect(f.service.setup(context,fields)).rejects.toThrow("entitlement_required");expect(f.writer.write).not.toHaveBeenCalled();});
 it("partial write failure cleans both names and removes nonactive metadata",async()=>{const f=fixture();f.writer.write.mockRejectedValueOnce(new Error(fields.privateKey));await expect(f.service.setup(context,fields)).rejects.toThrow(/^storage_unavailable$/);expect(f.writer.cleanup).toHaveBeenCalledWith(id);expect(f.store.removePending).toHaveBeenCalledOnce();});
 it("activation acknowledgement loss preserves the confirmed active pair",async()=>{const f=fixture();f.store.activate.mockRejectedValueOnce(new Error(fields.publicKey));f.store.cleanupState.mockResolvedValueOnce({status:"connected",public_secret_ref:refs.publicRef,private_secret_ref:refs.privateRef} as never);expect(await f.service.setup(context,fields)).toEqual({status:"connected"});expect(f.writer.cleanup).not.toHaveBeenCalled();});
 it("uncertain activation leaves a durable locator and logs only a safe ID",async()=>{const f=fixture(),log=vi.spyOn(console,"error").mockImplementation(()=>{});f.store.activate.mockRejectedValueOnce(new Error(fields.publicKey));f.store.cleanupState.mockRejectedValueOnce(new Error(fields.privateKey));await expect(f.service.setup(context,fields)).rejects.toThrow(/^storage_unavailable$/);expect(f.writer.cleanup).not.toHaveBeenCalled();expect(log).toHaveBeenCalledWith(JSON.stringify({event:"connection.cleanup_required",connectionId:id}));expect(JSON.stringify(log.mock.calls)).not.toContain(fields.publicKey);expect(JSON.stringify(log.mock.calls)).not.toContain(fields.privateKey);});
});

describe('approved customer-vault role contract',()=>{
 it('has exactly three approved data actions and no management permissions',async()=>{
  const {readFile}=await import('node:fs/promises');
  const role=JSON.parse(await readFile(new URL('../../deployment/azure/customer-credential-writer-role.json',import.meta.url),'utf8'));
  expect(role.Actions).toEqual([]);expect(role.NotActions).toEqual([]);expect(role.NotDataActions).toEqual([]);
  expect(role.DataActions).toEqual(['Microsoft.KeyVault/vaults/secrets/setSecret/action','Microsoft.KeyVault/vaults/secrets/readMetadata/action','Microsoft.KeyVault/vaults/secrets/delete']);
  expect(role.AssignableScopes).toEqual(['/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg']);
 });
});


describe('write-only credential cleanup',()=>{
 it('performs one DELETE with no polling/value GET and discards response data',async()=>{
  const token='synthetic-managed-identity-token';
  const credential={getToken:vi.fn(async()=>({token,expiresOnTimestamp:Date.now()+60000}))};
  const send=vi.fn(async(_url:string|URL|Request,_options?:RequestInit)=>new Response('synthetic-private',{status:200}));
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  try {
   expect(await deleteOnly(credential,send)(secretNames('11111111-1111-4111-8111-111111111111').publicKey,AbortSignal.timeout(1000))).toBeUndefined();
   expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][1]).toMatchObject({method:'DELETE',redirect:'error'});
   expect(log).not.toHaveBeenCalled();
  }finally{log.mockRestore();}
 });
 it('never returns token/body/error values on cleanup failure',async()=>{
  const credential={getToken:vi.fn(async()=>({token:'synthetic-token',expiresOnTimestamp:Date.now()+60000}))};
  const send=vi.fn(async()=>new Response('synthetic-private',{status:403}));
  await expect(deleteOnly(credential,send)(secretNames('11111111-1111-4111-8111-111111111111').privateKey,AbortSignal.timeout(1000))).rejects.toThrow(/^storage_unavailable$/);
  expect(send).toHaveBeenCalledTimes(1);
 });
});


describe('bounded validation deadline',()=>{
 it('aborts a stalled outbound request and emits only a fixed failure',async()=>{
  vi.useFakeTimers();
  try {
   const send=vi.fn(async(_url:string,options:{signal:AbortSignal})=>new Promise<never>((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('synthetic-private')),{once:true})));
   const pending=validateConnection(input,async()=>[{address:'8.8.8.8',family:4}],send as never);
   const check=expect(pending).rejects.toThrow(/^unreachable_host$/);
   await vi.advanceTimersByTimeAsync(10001);await check;expect(send).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
});


describe('control transport single-target enforcement',()=>{
 it('rejects a different endpoint before any network request',async()=>{
  const send=vi.fn(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}));
  await expect(runValidation(input,async(client,transport)=>{vi.stubGlobal('fetch',transport);try{await client.get('/company/companies');}finally{vi.unstubAllGlobals();}},async()=>[{address:'8.8.8.8',family:4}],send as never)).rejects.toThrow(/^connectwise_rejected$/);
  expect(send).not.toHaveBeenCalled();
 });
 it('prevents any second ConnectWise request',async()=>{
  const send=vi.fn(async()=>new Response('{}',{headers:{'Content-Type':'application/json'}}));
  await expect(runValidation(input,async(client,transport)=>{vi.stubGlobal('fetch',transport);try{await client.get('/system/info');await client.get('/system/info');}finally{vi.unstubAllGlobals();}},async()=>[{address:'8.8.8.8',family:4}],send as never)).rejects.toThrow(/^connectwise_rejected$/);
  expect(send).toHaveBeenCalledOnce();
 });
});
