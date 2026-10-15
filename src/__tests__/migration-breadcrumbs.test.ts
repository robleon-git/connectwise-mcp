import {describe,it,expect,vi,afterEach} from "vitest";
import {breadcrumb,migrationContext,validateMigrationContext} from "../database/migrationBreadcrumb.js";
import {createReceipt,receiptUrl,receiptStore,storeFromEnvironment} from "../database/migrationReceiptStore.js";
// @ts-expect-error Delivery script has no declarations.
import {releaseMigrationContext,contextEnv,receipt,pollReceipt,breadcrumbPreflight,readBlob} from "../../scripts/deploy/migration-breadcrumbs.mjs";
// @ts-expect-error Delivery script has no declarations.
import {migrationPlan} from "../../scripts/deploy/migration-features.mjs";
// @ts-expect-error Delivery script has no declarations.
import {receiptResources,noListCondition} from "../../scripts/deploy/render-migration-receipts.mjs";
const store={account:"monotorrcwreceipts6689",container:"migration-receipts"};
const image="monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:"+"a".repeat(64);
async function fixture() {
 const plan=await migrationPlan("core");
 const context=releaseMigrationContext({sha:"b".repeat(40),image},plan,{GITHUB_REPOSITORY:"robleon-git/connectwise-mcp",GITHUB_RUN_ID:"123",GITHUB_RUN_ATTEMPT:"2"});
 const execution="connectwise-migrate-example",result={requirements:plan.requirements,applied:0,appliedIds:[],deferredIds:plan.optionalIds,installedOptionalIds:[]};
 const start=breadcrumb(context,execution,"start"),end=breadcrumb(context,execution,"success",result);
 return {plan,context,execution,result,start,end,events:[start,end]};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe("isolated create-only Blob transport",()=>{
 it.each([201,409,412,403,500])("requires acknowledged creation, status %s",async status=>{
  const f=await fixture(),request=vi.fn(async()=>new Response(null,{status}));
  const promise=createReceipt(receiptUrl(store,f.context,f.execution,"start"),JSON.stringify(f.start),"synthetic-token",request as typeof fetch);
  if(status===201)await expect(promise).resolves.toBeUndefined();else await expect(promise).rejects.toThrow(status===409||status===412?"migration_receipt_conflict":"migration_receipt_publish_failed");
  expect(request).toHaveBeenCalledOnce();const opts=request.mock.calls[0] as unknown as [string,RequestInit];expect(opts[1]).toMatchObject({method:"PUT",redirect:"error",headers:{"If-None-Match":"*","x-ms-blob-type":"BlockBlob"}});
 });
 it("never retries publication on an ambiguous transport failure",async()=>{
  const f=await fixture(),request=vi.fn(async()=>{throw new Error("private-transport-detail");});
  await expect(createReceipt("https://example.invalid",JSON.stringify(f.end),"synthetic-token",request as typeof fetch)).rejects.toThrow(/^migration_receipt_publish_failed$/);expect(request).toHaveBeenCalledOnce();
 });
 it("builds exact paths from every required correlation segment",async()=>{
  const f=await fixture();expect(receiptUrl(store,f.context,f.execution,"completion")).toBe(`https://${store.account}.blob.core.windows.net/${store.container}/v1/${f.context.sha}/123/2/${f.context.request}/${f.execution}/completion.json`);
 });
 it("uses OIDC token privately and exact GET only; never invokes log queries or listing",async()=>{
  const f=await fixture(),call=vi.fn(async()=>"synthetic-token"),request=vi.fn(async()=>new Response(JSON.stringify(f.end),{status:200}));
  const url=receiptUrl(store,f.context,f.execution,"completion");expect(await readBlob(call,url,30000,request)).toEqual(f.end);
  expect(call.mock.calls[0]).toBeDefined();const invocation=request.mock.calls[0] as unknown as [string,RequestInit];expect(invocation[0]).toBe(url);expect(invocation[1].method).toBe("GET");expect(JSON.stringify(call.mock.calls)).not.toMatch(/loganalytics|list/);
 });
 it.each([403,500,404])("fails closed on access, transport or missing-container error %s",async status=>{
  await expect(readBlob(async()=>"synthetic-token","https://example.invalid",30000,async()=>new Response(null,{status}))).rejects.toThrow("migration_receipt_read_failed");
 });
 it("only BlobNotFound is a pollable absence, and oversized/invalid JSON is rejected",async()=>{
  expect(await readBlob(async()=>"synthetic-token","https://example.invalid",30000,async()=>new Response(null,{status:404,headers:{"x-ms-error-code":"BlobNotFound"}}))).toBeUndefined();
  for(const body of ["not-json","x".repeat(65537)])await expect(readBlob(async()=>"synthetic-token","https://example.invalid",30000,async()=>new Response(body))).rejects.toThrow("migration_receipt_read_failed");
 });
 it.each([{}, {account:"https://evil",container:"valid"},{...store,key:"forbidden"},{...store,container:"bad--name"}])("rejects malformed/secret-bearing store config",value=>{
  expect(()=>receiptStore(value)).toThrow("migration_store_invalid");
 });
 it("parses nonsecret runtime configuration",()=>{expect(storeFromEnvironment({CW_MIGRATION_RECEIPT_STORE:Buffer.from(JSON.stringify(store)).toString("base64url")})).toEqual(store);});
});
describe("exact receipt correlation and fail-closed completion",()=>{
 it("verifies start and completion with the full migration feature result",async()=>{
  const f=await fixture();expect(receipt(f.events,f.context,f.execution,f.plan).result).toEqual(f.result);
  expect(migrationContext({CW_MIGRATION_CONTEXT:contextEnv(f.context).split("=")[1],CONTAINER_APP_JOB_EXECUTION_NAME:f.execution},"core")).toEqual(f.context);
 });
 it.each(["repository","run","attempt","sha","image","request","selection","manifestFingerprint","requestedAt"])("rejects invalid context %s",async key=>{
  const f=await fixture();expect(()=>validateMigrationContext({...f.context,[key]:"invalid"})).toThrow();
 });
 it.each(["run","attempt","sha","image","request","selection","manifestFingerprint"])("rejects start/completion disagreement on %s",async key=>{
  const f=await fixture();expect(()=>receipt([f.start,{...f.end,context:{...f.context,[key]:"wrong"}}],f.context,f.execution,f.plan)).toThrow("migration_receipt_mismatch");
 });
 it("requires complete paired evidence and positive schema/transaction acknowledgement",async()=>{
  const f=await fixture();for(const events of [[],[f.start],[f.end]])expect(receipt(events,f.context,f.execution,f.plan)).toBeUndefined();
  for(const field of ["schemaVerified","transactionCommitted"])expect(()=>receipt([f.start,{...f.end,[field]:false}],f.context,f.execution,f.plan)).toThrow("migration_receipt_incomplete");
 });
 it("rejects wrong execution, stale timestamps, unknown fields, and expired >30-day evidence",async()=>{
  const f=await fixture();for(const e of [{...f.end,execution:"wrong"},{...f.end,timestamp:new Date(Date.now()-3600000).toISOString()},{...f.end,extra:"not-permitted"}])expect(()=>receipt([f.start,e],f.context,f.execution,f.plan)).toThrow();
  expect(()=>receipt(f.events,f.context,f.execution,f.plan,Date.now()+31*86400000)).toThrow("migration_receipt_expired");
 });
 it("rejects failed or conflicting terminal completion",async()=>{
  const f=await fixture(),failed=breadcrumb(f.context,f.execution,"failure");
  expect(()=>receipt([f.start,failed],f.context,f.execution,f.plan)).toThrow("migration_reported_failure");expect(()=>receipt([...f.events,failed],f.context,f.execution,f.plan)).toThrow("migration_receipt_conflict");
 });
 it("rejects partial/invalid migration results and secret-like unexpected result fields",async()=>{
  const f=await fixture();for(const result of [{...f.result,deferredIds:[]},{...f.result,appliedIds:["wrong"],applied:1},{...f.result,secret:"not-permitted"}])expect(()=>receipt([f.start,{...f.end,result}],f.context,f.execution,f.plan)).toThrow();
 });
});
describe("bounded exact-object retrieval after replicas disappear",()=>{
 it("fetches only start/completion at exact keys, independently of replicas",async()=>{
  const f=await fixture(),call=vi.fn(),read=vi.fn(async(_call,url:string)=>url.endsWith("start.json")?f.start:f.end);
  expect(await pollReceipt(call,f.context,f.execution,f.plan,{store,read})).toMatchObject({result:f.result});expect(call).not.toHaveBeenCalled();
  expect(read.mock.calls.map(c=>c[1])).toEqual([receiptUrl(store,f.context,f.execution,"start"),receiptUrl(store,f.context,f.execution,"completion")]);
 });
 it("polls delayed completion then succeeds",async()=>{
  const f=await fixture();let clock=Date.now(),round=0;
  const read=vi.fn(async(_call,url:string)=>url.endsWith("start.json")?f.start:round++?f.end:undefined);
  const sleep=vi.fn(async(ms:number)=>{clock+=ms;});await expect(pollReceipt(vi.fn(),f.context,f.execution,f.plan,{store,read,now:()=>clock,sleep,timeout:30000})).resolves.toBeDefined();expect(sleep).toHaveBeenCalledOnce();
 });
 it("missing completion stops at deadline without restarting a migration",async()=>{
  const f=await fixture();let clock=Date.now();const call=vi.fn(),read=vi.fn(async(_call,url:string)=>url.endsWith("start.json")?f.start:undefined);
  await expect(pollReceipt(call,f.context,f.execution,f.plan,{store,read,now:()=>clock,sleep:async(ms:number)=>{clock+=ms;},timeout:30000})).rejects.toThrow("migration_receipt_timeout");expect(read).toHaveBeenCalledTimes(4);expect(call).not.toHaveBeenCalled();
 });
 it("rejects a changed object between polling iterations",async()=>{
  const f=await fixture();let clock=Date.now(),round=0;const read=async(_call:unknown,url:string)=>url.endsWith("completion.json")?undefined:round++?{...f.start,timestamp:new Date(Date.now()+1).toISOString()}:f.start;
  await expect(pollReceipt(vi.fn(),f.context,f.execution,f.plan,{store,read,now:()=>clock,sleep:async(ms:number)=>{clock+=ms;}})).rejects.toThrow("migration_receipt_conflict");
 });
});
describe("storage prerequisites and minimum role proposals",()=>{
 const config={subscriptionId:"subscription",resourceGroup:"group",migrationJob:"job",location:"eastus"};
 const rendered=()=>receiptResources(config,store);
 function azure() {const r=rendered();return vi.fn(async(args:string[])=>{
  if(args.includes("job"))return JSON.stringify({retry:0,parallelism:1,completions:1});
  const url=args[args.indexOf("--url")+1]||"";
  return JSON.stringify(url.includes("managementPolicies")?r.lifecycle:url.includes("containers/")?r.container:url.includes("blobServices/")?r.service:r.account);
 });}
 it("checks security/lifecycle with metadata reads only and an exact access probe",async()=>{
  const call=azure(),read=vi.fn(async()=>undefined);await breadcrumbPreflight(call,config,store,read);
  expect(call.mock.calls.every(([a])=>a.includes("get")||a.includes("show"))).toBe(true);expect(JSON.stringify(call.mock.calls)).not.toMatch(/OperationalInsights|loganalytics|replica.*logs/);expect(read).toHaveBeenCalledOnce();
 });
 it.each(["sharedKey","anonymous","versioning","softDelete","lifecycle","retry"])("rejects unproven %s",async kind=>{
  const original=azure(),call=async(args:string[])=>{
   const s=await original(args);
   return kind==="sharedKey"?s.replace('"allowSharedKeyAccess":false','"allowSharedKeyAccess":true'):kind==="anonymous"?s.replace('"allowBlobPublicAccess":false','"allowBlobPublicAccess":true'):kind==="versioning"?s.replace('"isVersioningEnabled":false','"isVersioningEnabled":true'):kind==="softDelete"?s.replace('"deleteRetentionPolicy":{"enabled":false}','"deleteRetentionPolicy":{"enabled":true}'):kind==="lifecycle"?s.replace('"daysAfterModificationGreaterThan":30','"daysAfterModificationGreaterThan":90'):s.replace('"retry":0','"retry":1');
  };await expect(breadcrumbPreflight(call,config,store,async()=>undefined)).rejects.toThrow();
 });
 it("proposes create-only job access and no-list read-only GitHub access",()=>{
  const r=rendered();expect(r.jobCreator.DataActions).toEqual(["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/add/action"]);expect(r.jobCreator.Actions).toEqual([]);
  expect(r.githubReader.DataActions).toEqual(["Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read"]);expect(noListCondition).toContain("Blob.List");
  expect(JSON.stringify(r)).not.toMatch(/listKeys|OperationalInsights|loganalytics/);expect(r.scopes.container).toContain(`/containers/${store.container}`);
 });
});
