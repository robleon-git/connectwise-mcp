import {describe,it,expect,vi} from "vitest";
// @ts-expect-error Delivery script has no declarations.
import {executeMigration,verifyMigration} from "../../scripts/deploy/migration-execution.mjs";
// @ts-expect-error Delivery script has no declarations.
import {migrationPlan} from "../../scripts/deploy/migration-features.mjs";
// @ts-expect-error Delivery script has no declarations.
import {contextEnv,migrationAttestation,storeEnv} from "../../scripts/deploy/migration-breadcrumbs.mjs";
import {breadcrumb} from "../database/migrationBreadcrumb.js";
const sha="a".repeat(40),image="monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:"+"b".repeat(64);
const built={sha,image},c={migrationJob:"migration-job",resourceGroup:"group"},store={account:"monotorrcwreceipts6689",container:"migration-receipts"};
async function fixture(age=0){
 const plan=await migrationPlan("core"),context={repository:"robleon-git/connectwise-mcp",run:"123",attempt:"1",sha,image,request:"11111111-1111-4111-8111-111111111111",selection:"core",manifestFingerprint:plan.manifestFingerprint,requestedAt:new Date(Date.now()-age).toISOString()},execution="migration-1";
 const result={requirements:["core"],applied:1,appliedIds:["0008_account_name_edit"],deferredIds:plan.optionalIds,installedOptionalIds:[]};
 const start={...breadcrumb(context,execution,"start"),timestamp:context.requestedAt},end={...breadcrumb(context,execution,"success",result),timestamp:context.requestedAt};
 const evidence={version:"migration-breadcrumb-v1",context,execution,events:[start,end],result};
 const record={version:"release-migration-v1",status:"proven",context,execution,plan,result,attestation:migrationAttestation(evidence)};
 const call=vi.fn(async(_args:string[])=>JSON.stringify({status:"Succeeded",containers:[{image,command:["node"],args:["dist/database/cli.js","core"],context:[contextEnv(context).split("=")[1]],store:[storeEnv(store).split("=")[1]]}]}));
 const read=vi.fn(async(_call:unknown,url:string)=>url.endsWith("start.json")?start:end);
 return {plan,context,execution,result,start,end,record,call,read};
}
describe("migration receipt provenance reuse",()=>{
 it("revalidates exact execution and both exact Blob objects after replicas disappear",async()=>{
  const f=await fixture();await expect(verifyMigration(f.call,c,built,f.plan,f.record,{read:f.read})).resolves.toEqual(f.record);
  expect(f.call).toHaveBeenCalledOnce();expect(JSON.stringify(f.call.mock.calls)).not.toMatch(/replica|list|loganalytics|start/);expect(f.read.mock.calls.map(x=>x[1])).toEqual([`https://${store.account}.blob.core.windows.net/${store.container}/v1/${sha}/123/1/${f.context.request}/${f.execution}/start.json`,`https://${store.account}.blob.core.windows.net/${store.container}/v1/${sha}/123/1/${f.context.request}/${f.execution}/completion.json`]);
 });
 it("permits same-release reuse after an hour but expires at 30 days",async()=>{
  const f=await fixture(2*3600000);await expect(verifyMigration(f.call,c,built,f.plan,f.record,{read:f.read})).resolves.toBeDefined();
  const old=await fixture(31*86400000);await expect(verifyMigration(old.call,c,built,old.plan,old.record,{read:old.read})).rejects.toThrow("migration_receipt_expired");
 });
 it.each(["sha","image","selection","manifestFingerprint"])("rejects wrong %s before any Azure call",async key=>{
  const f=await fixture();const record={...f.record,context:{...f.context,[key]:"wrong"}};await expect(verifyMigration(f.call,c,built,f.plan,record,{read:f.read})).rejects.toThrow();expect(f.call).not.toHaveBeenCalled();
 });
 it.each(["missing","wrong-execution","wrong-run","failed","hash","result"])("rejects %s receipt evidence without a restart",async failure=>{
  const f=await fixture();let record=f.record;
  if(failure==="hash")record={...record,attestation:{...record.attestation,receiptHash:"0".repeat(64)}};
  if(failure==="result")record={...record,result:{...record.result,appliedIds:[]}};
  const read=async(_call:unknown,url:string)=>url.endsWith("start.json")?f.start:failure==="missing"?undefined:failure==="wrong-execution"?{...f.end,execution:"other"}:failure==="wrong-run"?{...f.end,context:{...f.context,run:"999"}}:failure==="failed"?breadcrumb(f.context,f.execution,"failure"):f.end;
  await expect(verifyMigration(f.call,c,built,f.plan,record,{read})).rejects.toThrow();expect(JSON.stringify(f.call.mock.calls)).not.toMatch(/"start"|"update"/);
 });
 it("a successful receipt cannot override Azure failure or changed execution arguments",async()=>{
  for(const change of [{status:"Failed"},{containers:[]}]){const f=await fixture();f.call.mockResolvedValueOnce(JSON.stringify({status:"Succeeded",containers:[],...change}));await expect(verifyMigration(f.call,c,built,f.plan,f.record,{read:f.read})).rejects.toThrow();expect(f.read).not.toHaveBeenCalled();}
 });
});
describe("one shared migration execution implementation",()=>{
 async function execution(status="Succeeded"){
  const f=await fixture();let update:string[]=[];
  const container=()=>({image,command:["node"],args:["dist/database/cli.js","core"],context:[update[update.indexOf("--set-env-vars")+1].split("=")[1]],store:[update[update.indexOf("--set-env-vars")+2].split("=")[1]]});
  const call=vi.fn(async(args:string[])=>{
   if(args.includes("update")){update=args;return "";}if(args.includes("start"))return f.execution;
   if(args.includes("properties.status"))return status;
   if(args.includes("show"))return JSON.stringify([container()]);throw Error("unexpected call");
  });
  const preflight=vi.fn(async()=>{}),write=vi.fn(async(_path:string,_body:string)=>{}),checkpoint=vi.fn(async()=>{});
  const retrieve=vi.fn(async(_call:unknown,context:typeof f.context,execution:string)=>({version:"migration-breadcrumb-v1",context,execution,events:[breadcrumb(context,execution,"start"),breadcrumb(context,execution,"success",f.result)],result:f.result}));
  const options={preflight,write,checkpoint,retrieve,sleep:vi.fn(async()=>{}),env:{GITHUB_REPOSITORY:"robleon-git/connectwise-mcp",GITHUB_RUN_ID:"456",GITHUB_RUN_ATTEMPT:"2"}};
  return {...f,call,preflight,write,checkpoint,retrieve,options};
 }
 it("checkpoints UNPROVEN first, starts once and records exact run/attempt plus applied/deferred IDs",async()=>{
  const f=await execution();const record=await executeMigration(f.call,c,built,f.plan,f.options);
  expect(f.preflight.mock.invocationCallOrder[0]).toBeLessThan(f.call.mock.invocationCallOrder[0]);expect(f.checkpoint.mock.invocationCallOrder[0]).toBeLessThan(f.call.mock.invocationCallOrder[0]);expect(record.context).toMatchObject({run:"456",attempt:"2",sha,image,selection:"core"});expect(record.result).toEqual(f.result);expect(f.call.mock.calls.filter(([a])=>a.includes("start"))).toHaveLength(1);expect(f.call.mock.calls.every(([a])=>a.slice(0,2).join()==="containerapp,job")).toBe(true);expect(f.call.mock.calls.find(([a])=>a.includes("update"))![0]).toContain("core");
 });
 it("missing infrastructure blocks before any mutation",async()=>{
  const f=await execution();f.preflight.mockRejectedValueOnce(Error("unavailable"));await expect(executeMigration(f.call,c,built,f.plan,f.options)).rejects.toThrow("unavailable");expect(f.call).not.toHaveBeenCalled();
 });
 it("commit followed by missing completion is UNPROVEN with no automatic retry",async()=>{
  const f=await execution();f.retrieve.mockRejectedValueOnce(Error("migration_receipt_timeout"));await expect(executeMigration(f.call,c,built,f.plan,f.options)).rejects.toThrow("migration_receipt_timeout");expect(f.call.mock.calls.filter(([a])=>a.includes("start"))).toHaveLength(1);expect(JSON.parse(f.write.mock.calls.at(-1)![1])).toMatchObject({completion:"unproven",azureExecutionSucceeded:true,execution:f.execution});
 });
 it("Azure failure cannot be made successful by valid receipts",async()=>{
  const f=await execution("Failed");await expect(executeMigration(f.call,c,built,f.plan,f.options)).rejects.toThrow("migration_not_succeeded");expect(f.call.mock.calls.filter(([a])=>a.includes("start"))).toHaveLength(1);
 });
});
