import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { MIGRATIONS, FORWARD_COMPATIBILITY, migrationHistoryReady, validateCompatibilityCatalog, validateMigrationHistory } from "../database/migrationManifest.js";
import { historicalRuntime, ORIGINAL_SHA, RELEASE_A_SHA, RELEASE_B_SHA, ORIGINAL_SOURCE, RELEASE_A_SOURCE, FUTURE_SQL } from "./fixtures/migration-compatibility-database.js";
// @ts-expect-error Delivery scripts have no declarations.
import { readMigrationContract } from "../../scripts/deploy/control-condition.mjs";
// @ts-expect-error Delivery scripts have no declarations.
import { schemaCompatibilityProof, prepareSchemaCompatibility, verifySchemaCompatibility, migrationPlan } from "../../scripts/deploy/migration-features.mjs";
const releaseA=historicalRuntime(RELEASE_A_SHA);
const current = releaseA.MIGRATIONS.filter(item=>item.requirement==="core").map(({id,checksum})=>({id,checksum}));
const future = {...releaseA.FORWARD_COMPATIBILITY![0]};
const complete=[...current,future];
describe("pinned forward history and historical readiness matrix",()=>{
 const original=historicalRuntime(ORIGINAL_SHA), next=historicalRuntime(RELEASE_B_SHA);
 it.each([
  ["original", original.migrationHistoryReady, true, false],
  ["Release A", releaseA.migrationHistoryReady, true, true],
  ["Release B reviewed feature", next.migrationHistoryReady, false, true],
  ["Release B current", migrationHistoryReady, false, true],
 ] as const)("%s current/future compatibility",(_name,check,before,after)=>{
  expect(check(current)).toBe(before);expect(check([...current,future])).toBe(after);
 });
 it("requires 0008 in execution rather than a redundant future catalog",()=>{
  expect(MIGRATIONS).toHaveLength(8);expect(FORWARD_COMPATIBILITY).toEqual([]);
  expect(MIGRATIONS.find(m=>m.id===future.id)).toMatchObject({...future,requirement:"core"});
  expect(migrationHistoryReady(current)).toBe(false);expect(migrationHistoryReady(complete)).toBe(true);
  expect(()=>validateMigrationHistory(complete)).not.toThrow();expect(()=>releaseA.validateMigrationHistory(complete)).toThrow("migration_history_mismatch");
 });
 it("retained Release A rejects wrong catalog checksums and unknown forward rows",()=>{
  expect(releaseA.migrationHistoryReady([...current,{...future,checksum:"0".repeat(64)}])).toBe(false);
  expect(releaseA.migrationHistoryReady([...current,{id:"0009_unknown",checksum:future.checksum}])).toBe(false);
 });
 it.each([
  {id:"9999_unknown",checksum:future.checksum}, {...future,checksum:"0".repeat(64)},
  {id:"0000_unknown",checksum:future.checksum}, {...future,checksum:null}, {id:1,checksum:future.checksum},
  null, {}, current[0],
 ])("rejects arbitrary, earlier, malformed and duplicate history %j",row=>{
  expect(migrationHistoryReady([...complete,row])).toBe(false);
 });
 it("known installed corruption is never masked by a valid future entry",()=>{
  for(const known of MIGRATIONS)expect(migrationHistoryReady([...complete.filter(row=>row.id!==known.id),{id:known.id,checksum:"0".repeat(64)}])).toBe(false);
  expect(migrationHistoryReady(complete.slice(1))).toBe(false);
 });
 it.each([null,{},[future,future],[{...future,id:"0007_unknown"}],[{...future,id:"0008_wrong"},future],[{...future,checksum:"bad"}],[{...future,requirement:"core"}]])("invalid catalog metadata fails even with no future row %j",catalog=>{
  expect(()=>validateCompatibilityCatalog(catalog as never,MIGRATIONS)).toThrow("invalid_migration_catalog");
  expect(migrationHistoryReady(complete,[],MIGRATIONS,catalog as never)).toBe(false);
 });
 it("allows non-contiguous explicitly pinned future IDs, never numeric blanket acceptance",()=>{
  const catalog=[{id:"0010_future",checksum:"a".repeat(64)}];
  expect(migrationHistoryReady([...complete,...catalog],[],MIGRATIONS,catalog)).toBe(true);
  expect(migrationHistoryReady([...complete,{...catalog[0],id:"0009_unknown"}],[],MIGRATIONS,catalog)).toBe(false);
 });
});

// Real guard with isolated Azure/Git transport. No network or live resource mutation.
async function transport() {
 const a="a".repeat(40), b="b".repeat(40), sha="c".repeat(40), registry="fixture";
 const c={registry,controlApi:"connectwise-control-api",resourceGroup:"control-rg",sharedResourceGroup:"mcp-rg"};
 const originalSource=ORIGINAL_SOURCE;
 const aSource=RELEASE_A_SOURCE;
 const bSource=await readFile("src/database/migrationManifest.ts","utf8");
 const sources:Record<string,string>={[a]:originalSource,[b]:aSource,[sha]:bSource};
 const files:Record<string,string>={};for(const m of MIGRATIONS)files[m.file]=await readFile("database/migrations/"+m.file,"utf8");
 files[future.id+".sql"]=FUTURE_SQL;
 const run=vi.fn(async(_cmd:string,args:string[])=>{
  const ref=args[0]==="ls-tree"?args[2]:args[1].split(":")[0], source=sources[ref];if(!source)throw new Error("missing immutable source");
  const names=[...source.matchAll(/file: "([a-z0-9_]+\.sql)"/g)].map(m=>m[1]);
  return {stdout:args[0]==="ls-tree"?names.map(name=>`100644 blob ${"d".repeat(40)}\tdatabase/migrations/${name}`).join("\n"):args[1].endsWith("migrationManifest.ts")?source:files[args[1].split("/").at(-1)!]};
 });
 const images:Record<string,{sha:string;digest:string}>={};
 const image=(kind:string,ref:string)=>{const digest="sha256:"+(ref===a?"1":ref===b?"2":"3").repeat(64);const v=`${registry}.azurecr.io/connectwise-${kind}@${digest}`;images[v]={sha:ref,digest};return v;};
 const oldMcp=image("mcp",b),oldControl=image("control-api",b),newMcp=image("mcp",sha),newControl=image("control-api",sha);
 let servingSha=b;
 const live={mcp:"connectwise-mcp-pilot--prior","control-api":"connectwise-control-api--prior"};
 const health:Record<string,string>={};
 const call=vi.fn(async(args:string[])=>{
  if(args[0]==="acr") {
   if(args.includes("digest")&&!args.includes("{digest:digest,tags:tags}"))return images[newMcp].digest;
   const key=args[args.indexOf("--name")+1], record=images[`${registry}.azurecr.io/${key}`];
   return JSON.stringify({digest:record?.digest,tags:[record?.sha]});
  }
  const kind=args.includes("connectwise-mcp-pilot")?"mcp":"control-api",name=kind==="mcp"?"connectwise-mcp-pilot":"connectwise-control-api";
  if(args.includes("revision")) {
   const revision=args[args.indexOf("--revision")+1];const ref=revision.endsWith("--target")||revision===`connectwise-mcp-pilot--s3-${sha.slice(0,12)}`?sha:servingSha;
   return JSON.stringify({image:image(kind,ref),health:health[revision]||"Healthy",fqdn:`${name}--fixture.domain.eastus.azurecontainerapps.io`});
  }
  return JSON.stringify({mode:kind==="mcp"?"Single":"Multiple",revision:live[kind],traffic:[{revisionName:live[kind],weight:100}]});
 });
 return {a,b,sha,c,run,call,sources,bSource,aSource,oldMcp,oldControl,newMcp,newControl, image, setServing:(ref:string)=>{servingSha=ref;}, built:{sha,image:newControl}, plan:await migrationPlan("core"),live,health};
}
describe("artifact-bound delivery schema compatibility",()=>{
 it("B prepares against Release A serving pair; proof names explicit rollback images and pins contracts/plan",async()=>{
  const t=await transport();const proof=await prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run);
  expect(proof.compatible).toBe(true);expect(proof.target).toMatchObject({sha:t.sha,mcpImage:t.newMcp,controlImage:t.newControl,plan:t.plan});
  expect(proof.serving.mcp.image).toBe(t.oldMcp);expect(proof.rollback).toMatchObject({eligible:true,mcp:proof.serving.mcp,control:proof.serving.control});
  const manifest={...t.built,schemaPlan:t.plan,schemaCompatibility:proof,previousRevision:proof.rollback.control.revision,previousImage:proof.rollback.control.image,revision:"connectwise-control-api--target"};
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"promote",t.run)).resolves.toEqual(proof);
 });
 it("B cannot prepare with 0008 while original production or rollback remains eligible",async()=>{
  const t=await transport();t.setServing(t.a);const contract=await readMigrationContract(t.sha,t.run);
  const plan={...t.plan,requiredIds:contract.execution.filter((m:{requirement:string})=>m.requirement==="core").map((m:{id:string})=>m.id)};
  await expect(prepareSchemaCompatibility(t.call,t.c,t.built,plan,t.run)).rejects.toThrow("release_schema_incompatible");
  t.setServing(t.b);await expect(prepareSchemaCompatibility(t.call,t.c,t.built,plan,t.run)).resolves.toMatchObject({compatible:true,rollback:{eligible:true}});
 });
 it("wrong Release A catalog checksum and absent support cannot authorize B",async()=>{
  const t=await transport();t.setServing(t.b);t.sources[t.sha]=t.bSource;
  const target=await readMigrationContract(t.sha,t.run), old=await readMigrationContract(t.b,t.run);
  const artifact={revision:"fixture--prior",image:t.oldMcp,sha:t.b,contract:old};
  const plan={...t.plan,requiredIds:target.execution.filter((m:{requirement:string})=>m.requirement==="core").map((m:{id:string})=>m.id)};
  for(const catalog of [[{...future,checksum:"0".repeat(64)}],[]])expect(()=>schemaCompatibilityProof({sha:t.sha,controlImage:t.newControl,mcpImage:t.newMcp,contract:target,plan},{mcp:{...artifact,contract:{...old,catalog}},control:artifact})).toThrow("release_schema_incompatible");
 });
 it.each(["target", "serving", "rollback", "plan", "missing"])("rejects tampered/missing %s evidence",async field=>{
  const t=await transport();const proof=await prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run);
  const manifest={...t.built,schemaPlan:t.plan,schemaCompatibility:structuredClone(proof),previousRevision:proof.rollback.control.revision,previousImage:proof.rollback.control.image,revision:"connectwise-control-api--target"};
  if(field==="missing")manifest.schemaCompatibility=undefined;
  else if(field==="plan")manifest.schemaPlan={...t.plan,manifestFingerprint:"bad"};
  else if(field==="target")manifest.schemaCompatibility.target.controlImage=t.oldControl;
  else manifest.schemaCompatibility[field].mcp.contractFingerprint="bad";
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"promote",t.run)).rejects.toThrow();
 });
 it("lost registry provenance, source or retained revision fails closed",async()=>{
  const t=await transport();t.sources[t.b]="export const MIGRATIONS=load();";
  await expect(prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run)).rejects.toThrow("migration_contract_unproven");
  t.call.mockResolvedValue(JSON.stringify({digest:"sha256:"+"0".repeat(64),tags:[t.sha]}));
  await expect(prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run)).rejects.toThrow();
 });
 it("rollback rechecks retained control readiness; old proof cannot authorize 217 against schema 0008",async()=>{
  const t=await transport();const proof=await prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run);
  const manifest={...t.built,schemaPlan:t.plan,schemaCompatibility:proof,previousRevision:proof.rollback.control.revision,previousImage:proof.rollback.control.image,revision:"connectwise-control-api--target"};
  const ready=vi.fn(async()=>{throw new Error("smoke_failed");});
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"rollback",t.run,ready)).rejects.toThrow("smoke_failed");expect(ready).toHaveBeenCalledOnce();
 });
});

describe("compatibility proof across promotion, cutover and rollback ordering",()=>{
 it("cutover requires the promoted target control while MCP is unchanged",async()=>{
  const t=await transport(),proof=await prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run);
  const manifest={...t.built,schemaPlan:t.plan,schemaCompatibility:proof,previousRevision:proof.rollback.control.revision,previousImage:proof.rollback.control.image,revision:"connectwise-control-api--target"};
  t.live['control-api']=manifest.revision;
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"cutover",t.run)).resolves.toEqual(proof);
  t.live.mcp="connectwise-mcp-pilot--unrelated";
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"cutover",t.run)).rejects.toThrow("serving_artifact_changed");
 });
 it("inactive retained MCP does not block verified rollback; recovered MCP permits control rollback",async()=>{
  const t=await transport(),proof=await prepareSchemaCompatibility(t.call,t.c,t.built,t.plan,t.run);
  const manifest={...t.built,schemaPlan:t.plan,schemaCompatibility:proof,previousRevision:proof.rollback.control.revision,previousImage:proof.rollback.control.image,revision:"connectwise-control-api--target"};
  t.live.mcp=`connectwise-mcp-pilot--s3-${t.sha.slice(0,12)}`;t.live['control-api']=manifest.revision;
  t.health[proof.rollback.mcp.revision]="None";
  const ready=vi.fn(async()=>{});
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"rollback",t.run,ready)).resolves.toEqual(proof);
  t.live.mcp=`connectwise-mcp-pilot--s3-recovery-${t.sha.slice(0,12)}`;
  await expect(verifySchemaCompatibility(t.call,t.c,manifest,"rollback",t.run,ready)).resolves.toEqual(proof);
  expect(ready).toHaveBeenCalledTimes(2);
 });
 it("mixed rollback history-support sets are rejected rather than inferred compatible",async()=>{
  const t=await transport(),old=await readMigrationContract(t.a,t.run),next=await readMigrationContract(t.b,t.run);
  const artifact={revision:"fixture--prior",image:t.oldMcp,sha:t.a,contract:old};
  expect(()=>schemaCompatibilityProof({sha:t.sha,controlImage:t.newControl,mcpImage:t.newMcp,contract:next,plan:{...t.plan,requiredIds:next.execution.filter((m:{requirement:string})=>m.requirement==="core").map((m:{id:string})=>m.id)}},
   {mcp:artifact,control:{...artifact,contract:next}})).toThrow("release_schema_incompatible");
 });
});
