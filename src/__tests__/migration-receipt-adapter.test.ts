import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
// Keep the production adapter and receipt functions real; mock only process/network boundaries.
const processBoundary=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock("../../scripts/deploy/common.mjs",async original=>({...await original<object>(),execute:processBoundary.execute}));
// @ts-expect-error Delivery script has no declarations.
import {mcpAz,releaseDiagnostic} from "../../scripts/deploy/mcp-release-diagnostics.mjs";
// @ts-expect-error Delivery script has no declarations.
import {readBlob,breadcrumbPreflight,pollReceipt,releaseMigrationContext} from "../../scripts/deploy/migration-breadcrumbs.mjs";
// @ts-expect-error Delivery script has no declarations.
import {migrationPlan} from "../../scripts/deploy/migration-features.mjs";
// @ts-expect-error Delivery script has no declarations.
import {receiptResources} from "../../scripts/deploy/render-migration-receipts.mjs";
import {breadcrumb} from "../database/migrationBreadcrumb.js";
import {receiptUrl} from "../database/migrationReceiptStore.js";
const store={account:"monotorrcwreceipts6689",container:"migration-receipts"};
const c={subscriptionId:"synthetic-subscription",resourceGroup:"synthetic-group",migrationJob:"synthetic-job",location:"eastus"};
const token="synthetic-private-token-canary",url=`https://${store.account}.blob.core.windows.net/${store.container}/v1/access-probe.json`;
const network=vi.fn();
// Assert only the executed program/argv; never serialize inherited environment or options.
function expectReadOnlyCommands(calls: readonly (readonly unknown[])[]) {
 const commands=calls.map(([executable,args])=>[executable,args]);
 for(const [executable]of commands)expect(executable).toBe("az");
 expect(JSON.stringify(commands)).not.toMatch(/"(?:list|create|update|set|start|delete|put|post|patch|replica|logs)"|listKeys|log[-]?analytics|OperationalInsights/i);
}
beforeEach(()=>{processBoundary.execute.mockReset();network.mockReset();vi.stubGlobal("fetch",network);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("mcpAz options contract",()=>{
 it("retains default timeout, output bound, no dynamic extension install and trimmed output",async()=>{
  vi.stubEnv("AZURE_EXTENSION_USE_DYNAMIC_INSTALL","yes_without_prompt");processBoundary.execute.mockResolvedValue({stdout:" value\n"});
  await expect(mcpAz(["account","show"])).resolves.toBe("value");
  expect(processBoundary.execute).toHaveBeenCalledExactlyOnceWith("az",["account","show","--only-show-errors"],expect.objectContaining({timeout:120000,maxBuffer:1024*1024,env:expect.objectContaining({AZURE_EXTENSION_USE_DYNAMIC_INSTALL:"no"})}));
 });
 it("forwards a caller's bounded timeout separately from executor injection",async()=>{
  const run=vi.fn(async()=>({stdout:" injected\n"}));await expect(mcpAz(["account","show"],{timeout:15000},run)).resolves.toBe("injected");
  expect(run).toHaveBeenCalledWith("az",expect.any(Array),expect.objectContaining({timeout:15000,maxBuffer:1024*1024}));expect(processBoundary.execute).not.toHaveBeenCalled();
 });
 it.each([0,-1,120001,1.5,NaN,Infinity,null,"30000"])("rejects invalid timeout %s without invoking the CLI",async timeout=>{
  const error=await mcpAz(["account","show"],{timeout}).catch((e:unknown)=>e);expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("azure_operation_failed");expect(releaseDiagnostic(error).category).toBe("unknown");expect(processBoundary.execute).not.toHaveBeenCalled();
 });
 it.each([null,[],{env:{SECRET:"forbidden"}},{maxBuffer:1}])("does not accept options that override execution safeguards: %j",async options=>{
  await expect(mcpAz(["account","show"],options)).rejects.toThrow(/^azure_operation_failed$/);expect(processBoundary.execute).not.toHaveBeenCalled();
 });
});
describe("real receipt reader through the production mcpAz adapter",()=>{
 it("obtains a token and reads one exact Blob with the 30-second caller budget",async()=>{
  processBoundary.execute.mockResolvedValue({stdout:token+"\n"});network.mockResolvedValue(new Response(JSON.stringify({receipt:"synthetic"}),{status:200}));
  await expect(readBlob(mcpAz,url)).resolves.toEqual({receipt:"synthetic"});
  expect(processBoundary.execute).toHaveBeenCalledExactlyOnceWith("az",["account","get-access-token","--resource","https://storage.azure.com/","--query","accessToken","-o","tsv","--only-show-errors"],expect.objectContaining({timeout:30000}));
  expect(network).toHaveBeenCalledExactlyOnceWith(url,expect.objectContaining({method:"GET",redirect:"error",headers:expect.objectContaining({Authorization:`Bearer ${token}`})}));
 });
 it("expires after token acquisition instead of extending the request deadline",async()=>{
  let clock=100000;vi.spyOn(Date,"now").mockImplementation(()=>clock);processBoundary.execute.mockImplementation(async()=>{clock+=30001;return {stdout:token};});
  await expect(readBlob(mcpAz,url)).rejects.toThrow(/^migration_receipt_read_failed$/);expect(network).not.toHaveBeenCalled();expect(processBoundary.execute).toHaveBeenCalledOnce();
 });
 it("redacts CLI failures and does not fetch or retry after token acquisition fails",async()=>{
  const log=vi.spyOn(console,"log"),errorLog=vi.spyOn(console,"error");
  processBoundary.execute.mockRejectedValue(Object.assign(new Error(token),{stdout:token,stderr:`ERROR: (AuthorizationFailed) ${token}`,headers:token}));
  const error=await readBlob(mcpAz,url).catch((e:unknown)=>e);expect((error as Error).message).toBe("migration_receipt_read_failed");expect(JSON.stringify(error)).not.toContain(token);expect((error as Error).cause).toBeUndefined();expect(network).not.toHaveBeenCalled();expect(processBoundary.execute).toHaveBeenCalledOnce();expect(log).not.toHaveBeenCalled();expect(errorLog).not.toHaveBeenCalled();
 });
 it.each([403,500,404])("fails closed on receipt HTTP %s without retries or mutations",async status=>{
  processBoundary.execute.mockResolvedValue({stdout:token});network.mockResolvedValue(new Response(null,{status}));
  await expect(readBlob(mcpAz,url)).rejects.toThrow(/^migration_receipt_read_failed$/);expect(network).toHaveBeenCalledOnce();expect(processBoundary.execute).toHaveBeenCalledOnce();
 });
 it("preserves only exact BlobNotFound as a pollable absence",async()=>{
  processBoundary.execute.mockResolvedValue({stdout:token});network.mockResolvedValue(new Response(null,{status:404,headers:{"x-ms-error-code":"BlobNotFound"}}));await expect(readBlob(mcpAz,url)).resolves.toBeUndefined();
 });
 it("verifies correlated start/completion through the real reader/adapter after replicas are gone",async()=>{
  vi.stubEnv("GITHUB_ARTIFACTS_LIST","list create update set start loganalytics replica listKeys");
  const plan=await migrationPlan("core"),context=releaseMigrationContext({sha:"a".repeat(40),image:"monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:"+"b".repeat(64)},plan,{GITHUB_REPOSITORY:"robleon-git/connectwise-mcp",GITHUB_RUN_ID:"123",GITHUB_RUN_ATTEMPT:"1"}),execution="synthetic-execution";
  const result={requirements:plan.requirements,applied:1,appliedIds:["0008_account_name_edit"],deferredIds:plan.optionalIds,installedOptionalIds:[]};
  const start=breadcrumb(context,execution,"start"),end=breadcrumb(context,execution,"success",result);processBoundary.execute.mockResolvedValue({stdout:token});
  network.mockImplementation(async(requestUrl:string)=>new Response(JSON.stringify(requestUrl.endsWith("start.json")?start:end),{status:200}));
  await expect(pollReceipt(mcpAz,context,execution,plan,{store})).resolves.toMatchObject({execution,result});expect(network.mock.calls.map(c=>c[0])).toEqual([receiptUrl(store,context,execution,"start"),receiptUrl(store,context,execution,"completion")]);expect(processBoundary.execute).toHaveBeenCalledTimes(2);expectReadOnlyCommands(processBoundary.execute.mock.calls);
 });
});
describe("real migration receipt preflight through the production adapter",()=>{
 function metadata(){const resources=receiptResources(c,store);processBoundary.execute.mockImplementation(async(name:string,args:string[])=>{
  if(name!=="az")throw Error("unexpected process");
  if(args.includes("get-access-token"))return {stdout:token};
  if(args.includes("job"))return {stdout:JSON.stringify({retry:0,parallelism:1,completions:1})};
  const target=args[args.indexOf("--url")+1]||"";
  return {stdout:JSON.stringify(target.includes("managementPolicies")?resources.lifecycle:target.includes("containers/")?resources.container:target.includes("blobServices/")?resources.service:resources.account)};
 });return resources;}
 it("reaches the exact access-probe GET using existing OIDC, with no mutation or Blob listing",async()=>{
  vi.stubEnv("GITHUB_ARTIFACTS_LIST","list create update set start loganalytics replica listKeys");
  metadata();network.mockResolvedValue(new Response(null,{status:404,headers:{"x-ms-error-code":"BlobNotFound"}}));await expect(breadcrumbPreflight(mcpAz,c,store)).resolves.toBeUndefined();expect(network).toHaveBeenCalledExactlyOnceWith(url,expect.objectContaining({method:"GET",redirect:"error"}));expect(processBoundary.execute).toHaveBeenCalledTimes(6);
  expect(processBoundary.execute.mock.calls.every(([,args])=>args.includes("get")||args.includes("show")||args.includes("get-access-token"))).toBe(true);expectReadOnlyCommands(processBoundary.execute.mock.calls);expect(processBoundary.execute.mock.calls.at(-1)![2]).toMatchObject({timeout:30000});
 });
 it("still rejects unsafe receipt-store policy before an access probe or mutation",async()=>{
  const resources=metadata();resources.account.properties.allowSharedKeyAccess=true;
  await expect(breadcrumbPreflight(mcpAz,c,store)).rejects.toThrow("migration_store_security_unproven");expect(network).not.toHaveBeenCalled();expect(processBoundary.execute.mock.calls.every(([,args])=>args.includes("get"))).toBe(true);
 });
});


describe("read-only command assertion boundary",()=>{
 it("ignores inherited forbidden words and all execution options/metadata",()=>{
  const options={env:{GITHUB_ARTIFACTS_LIST:"list create update set start loganalytics replica listKeys"},timeout:30000,toJSON(){throw Error("options must not be inspected");}};
  expect(()=>expectReadOnlyCommands([["az",["account","get-access-token"],options]])).not.toThrow();
 });
 it.each([
  ["account","get-access-token","--resource","https://storage.azure.com/"],
  ["resource","show","--ids","/synthetic/resource"],
  ["containerapp","job","show","--name","synthetic-job"],
  ["containerapp","job","show","--query","properties.configuration.replicaRetryLimit"]
 ])("accepts safe argv %j",(...args:string[])=>{
  expect(()=>expectReadOnlyCommands([["az",args]])).not.toThrow();
 });
 it.each([
  ["storage","blob","list"],
  ["storage","container","list"],
  ["containerapp","job","create"],
  ["containerapp","job","update"],
  ["containerapp","ingress","traffic","set"],
  ["containerapp","job","start"],
  ["monitor","log-analytics","query"],
  ["rest","--url","https://management.azure.com/providers/Microsoft.OperationalInsights/workspaces/synthetic/query"],
  ["containerapp","job","replica","logs","show"],
  ["storage","account","keys","list"],
  ["rest","--url","https://management.azure.com/synthetic/listKeys"],
  ["rest","--method","POST"],
  ["resource","delete"]
 ])("rejects forbidden argv %j",(...args:string[])=>{
  expect(()=>expectReadOnlyCommands([["az",args,{env:{SAFE:"value"}}]])).toThrow();
 });
 it("checks the executable as well as argv",()=>{
  expect(()=>expectReadOnlyCommands([["untrusted-program",["account","show"]]])).toThrow();
 });
});
