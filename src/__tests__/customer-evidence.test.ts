import { ENTITLEMENT_CASES } from "./fixtures/entitlement-cases.js";
import {afterEach,describe,expect,it,vi} from "vitest";
import {withCustomerEvidence,customerAccessOutcome,customerSecretGetAttempt,connectWiseGetAttempt} from "../auth/customer-evidence.js";
import {AccountAccessStore,createCustomerConfigProvider} from "../auth/customer-access.js";
import {customerCredentialReader} from "../auth/customer-vault.js";
import {customerTransport} from "../auth/customer-transport.js";
import {CUSTOMER_VAULT_URI,secretNames} from "../connections/vault.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {CwManageClient} from "../api-client.js";
import {createServer} from "node:http";
import {createHttpHandler} from "../http-server.js";
const issuer="https://issuer.example",principal={issuer,subject:"DO-NOT-LOG-SUBJECT"};
const uid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",aid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",cid="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const row={id:cid,server_url:"https://customer.example.com",company_id:"DO-NOT-LOG-COMPANY",public_secret_ref:`${CUSTOMER_VAULT_URI}/secrets/${secretNames(cid).publicKey}/${"a".repeat(32)}`,private_secret_ref:`${CUSTOMER_VAULT_URI}/secrets/${secretNames(cid).privateKey}/${"b".repeat(32)}`};
afterEach(()=>vi.restoreAllMocks());
function capture(){const log=vi.spyOn(console,"error").mockImplementation(()=>{});return {log,events:()=>log.mock.calls.filter(c=>String(c[0]).includes('"event":"mcp.access_evidence"')).map(c=>JSON.parse(String(c[0])))};}
function queryFixture(options:{unknown?:boolean;expired?:boolean;revoked?:boolean;unconfigured?:boolean;malformed?:boolean;failure?:boolean}={}){
 return vi.fn(async(sql:string)=>{if(options.failure)throw new Error("DO-NOT-LOG-DATABASE-ERROR");return {rows:sql.includes("external_mcp_identities")?options.unknown?[]:[{user_id:uid,account_id:aid}]:sql.includes("entitlements")?[{source:"trial",status:options.revoked?"suspended":"active",starts_at:new Date(0),ends_at:new Date(options.expired?1:Date.now()+10000),evaluated_at:new Date()}]:options.unconfigured?[]:[{...row,private_secret_ref:options.malformed?"DO-NOT-LOG-REFERENCE":row.private_secret_ref}]};});
}
describe("bounded request-scoped authorization evidence",()=>{
 it.each(["unknown","expired","revoked","unconfigured","malformed","failure"] as const)("%s records no secret or CW attempts",async condition=>{
  const out=capture(),getSecret=vi.fn(),send=vi.fn(),query=queryFixture({[condition]:true});
  const provider=createCustomerConfigProvider(new AccountAccessStore({query} as never,issuer),customerCredentialReader({getSecret} as never));
  await withCustomerEvidence({},async()=>{try{await provider(principal);}catch{customerAccessOutcome(condition==="unconfigured"?"setup_required":condition==="failure"?"service_unavailable":"access_denied");}});
  expect(getSecret).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  expect(out.events()).toEqual([expect.objectContaining({customerSecretGetAttempts:0,connectWiseGetAttempts:0})]);
  const printed=JSON.stringify(out.log.mock.calls);for(const value of [principal.subject,uid,aid,cid,row.company_id,row.server_url,row.private_secret_ref,"DO-NOT-LOG-DATABASE-ERROR"])expect(printed).not.toContain(value);
 });
 it.each(ENTITLEMENT_CASES.filter(c=>!c.allowed))("$name denies before connection with measured zero calls",async({rows})=>{
  const out=capture(),getSecret=vi.fn(),send=vi.fn();
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("external_mcp_identities")?[{user_id:uid,account_id:aid}]:rows}));
  await withCustomerEvidence({},async()=>{try{const c=await createCustomerConfigProvider(new AccountAccessStore({query} as never,issuer),customerCredentialReader({getSecret} as never))(principal);const t=customerTransport(c.baseUrl,async()=>[],send as never);try{await t.transport(c.baseUrl,{method:"GET"});}finally{await t.close();}}catch{customerAccessOutcome("access_denied");}});
  expect(query).toHaveBeenCalledTimes(2);expect(getSecret).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  expect(out.events()).toEqual([expect.objectContaining({customerSecretGetAttempts:0,connectWiseGetAttempts:0})]);
 });
 it("counts exact version GETs and one GET dispatch without payload/header leakage",async()=>{
  const out=capture(),getSecret=vi.fn(async()=>({value:"DO-NOT-LOG-API-KEY"})),send=vi.fn(async()=>Response.json({private:"DO-NOT-LOG-BODY"}));
  const provider=createCustomerConfigProvider(new AccountAccessStore({query:queryFixture()} as never,issuer),customerCredentialReader({getSecret} as never));
  await withCustomerEvidence({headers:{authorization:"Bearer DO-NOT-LOG-TOKEN"}},async()=>{
   const c=await provider(principal);customerAccessOutcome("authorized");
   const transport=customerTransport(c.baseUrl,async()=>[{address:"93.184.216.34",family:4}],send as never);
   try{const response=await transport.transport(`${c.baseUrl}/v4_6_release/apis/3.0/system/info`,{method:"GET",headers:{Authorization:"Basic DO-NOT-LOG-AUTH"}});await response.body?.cancel();}finally{await transport.close();}
  });
  expect(getSecret).toHaveBeenCalledTimes(2);expect(send).toHaveBeenCalledOnce();expect(out.events()[0]).toMatchObject({outcome:"authorized",customerSecretGetAttempts:2,connectWiseGetAttempts:1});
  expect(Object.keys(out.events()[0]).sort()).toEqual(["event","requestId","outcome","customerSecretGetAttempts","connectWiseGetAttempts"].sort());
  expect(JSON.stringify(out.log.mock.calls)).not.toMatch(/DO-NOT-LOG|customer.example|vault.azure.net|Bearer|Basic/);
 });
 it("counts failed secret GET attempts and blocks CW execution",async()=>{
  const out=capture(),getSecret=vi.fn(async()=>{throw new Error("DO-NOT-LOG-SECRET");});
  await withCustomerEvidence({},async()=>{try{await createCustomerConfigProvider(new AccountAccessStore({query:queryFixture()} as never,issuer),customerCredentialReader({getSecret} as never))(principal);}catch{customerAccessOutcome("service_unavailable");}});
  expect(out.events()[0]).toMatchObject({customerSecretGetAttempts:1,connectWiseGetAttempts:0,outcome:"service_unavailable"});
 });
 it("keeps concurrent contexts separate and emits even on failure",async()=>{
  const out=capture();await Promise.all([withCustomerEvidence({},async()=>{customerSecretGetAttempt();await new Promise(r=>setTimeout(r,20));customerSecretGetAttempt();connectWiseGetAttempt();customerAccessOutcome("authorized");}),
   withCustomerEvidence({},async()=>{await new Promise(r=>setTimeout(r,1));customerAccessOutcome("setup_required");})]);
  expect(out.events()).toEqual([expect.objectContaining({outcome:"setup_required",customerSecretGetAttempts:0,connectWiseGetAttempts:0}),expect.objectContaining({outcome:"authorized",customerSecretGetAttempts:2,connectWiseGetAttempts:1})]);
  expect(new Set(out.events().map(e=>e.requestId)).size).toBe(2);
  await expect(withCustomerEvidence({},async()=>{throw new Error("DO-NOT-LOG-RAW");})).rejects.toThrow();expect(out.events()).toHaveLength(3);
  expect(JSON.stringify(out.log.mock.calls)).not.toContain("DO-NOT-LOG-RAW");
 });
 it("observes authentication denials on /mcp only, without a public diagnostic endpoint",async()=>{
  const out=capture(),provider=vi.fn(),handler=createHttpHandler({authenticate:async()=>false,customerConfigProvider:provider});
  const server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try{const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
   expect((await fetch(origin+"/mcp",{method:"POST",headers:{Authorization:"Bearer DO-NOT-LOG-TOKEN"}})).status).toBe(401);
   expect((await fetch(origin+"/diagnostics")).status).toBe(404);expect((await fetch(origin+"/health")).status).toBe(200);
   expect(provider).not.toHaveBeenCalled();expect(out.events()).toEqual([expect.objectContaining({outcome:"authentication_denied",customerSecretGetAttempts:0,connectWiseGetAttempts:0})]);
   expect(JSON.stringify(out.log.mock.calls)).not.toContain("DO-NOT-LOG-TOKEN");
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
 it("records actual SDK discovery and tool calls after asynchronous execution finishes",async()=>{
  const out=capture(),getSecret=vi.fn(async()=>({value:"DO-NOT-LOG-KEY"}));
  const provider=createCustomerConfigProvider(new AccountAccessStore({query:queryFixture()} as never,issuer),customerCredentialReader({getSecret} as never));
  const handler=createHttpHandler({authenticate:async()=>({authenticated:true,principal}),customerConfigProvider:provider,
   customerClientFactory:config=>{const transport=customerTransport(config.baseUrl,async()=>[{address:"93.184.216.34",family:4}],(async()=>{await new Promise(r=>setTimeout(r,10));return Response.json({version:"synthetic"});}) as never);return {client:new CwManageClient(config,transport.transport),close:transport.close};}});
  const server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const client=new Client({name:"evidence-test",version:"1"});
  try{await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`)));
   expect((await client.listTools()).tools).toHaveLength(39);await client.callTool({name:"cw_test_connection",arguments:{}});
   const events=out.events().filter(e=>e.outcome==="authorized");expect(events.length).toBeGreaterThanOrEqual(3);
   expect(events.every(e=>e.customerSecretGetAttempts===2)).toBe(true);expect(events.filter(e=>e.connectWiseGetAttempts===1)).toHaveLength(1);
   expect(JSON.stringify(out.log.mock.calls)).not.toMatch(/DO-NOT-LOG|customer.example.com|vault.azure.net/);
  }finally{await client.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
 });
 it("keeps malformed request URLs inside the sanitized HTTP error boundary",async()=>{
  const out=capture(),writeHead=vi.fn(),end=vi.fn(),provider=vi.fn();
  const handler=createHttpHandler({authenticate:async()=>false,customerConfigProvider:provider});
  await expect(handler({url:"http://[",headers:{},method:"POST"} as never,{once:vi.fn(),writeHead,end} as never)).resolves.toBeUndefined();
  expect(writeHead).toHaveBeenCalledWith(500,expect.anything());expect(end).toHaveBeenCalledWith(JSON.stringify({error:"internal_error"}));expect(provider).not.toHaveBeenCalled();expect(out.events()).toHaveLength(0);
 });
 it("rejects arbitrary outcome strings and records nothing outside an MCP request context",async()=>{
  const out=capture();customerSecretGetAttempt();connectWiseGetAttempt();expect(out.events()).toHaveLength(0);
  await withCustomerEvidence({},async()=>customerAccessOutcome("DO-NOT-LOG-CLAIM" as never));expect(out.events()[0].outcome).toBe("service_unavailable");
 });
});
