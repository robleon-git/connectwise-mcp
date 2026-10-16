import {describe,it,expect,vi} from "vitest";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
// @ts-expect-error Delivery script has no declarations.
import {controlCondition,requireControlOnlyImpact,schemaCompatibility,requireControlTraffic} from "../../scripts/deploy/control-condition.mjs";
const before="a".repeat(40),after="b".repeat(40),fingerprint="c".repeat(64);
const names=Array.from({length:39},(_,i)=>`dist/module-${i}.js`);
const impact={impact:"unchanged",changedOutputs:[],reachableModuleCount:39,moduleNames:names,previousModuleNames:names,protectedInputsEqual:true,outputFingerprint:fingerprint,previousOutputFingerprint:fingerprint};
const sql="CREATE TABLE example(id int);\n",checksum=createHash("sha256").update(sql).digest("hex");
const manifest=`export const MIGRATIONS=Object.freeze([{id:"0001_example",file:"0001_example.sql",checksum:"${checksum}"}]);`;
const tree=`100644 blob ${"d".repeat(40)}\tdatabase/migrations/0001_example.sql\n`;
function git(change:Record<string,string>={}){return vi.fn(async(_cmd:string,args:string[])=>({stdout:args[0]==="ls-tree"?(change[args[2]+":tree"]??tree):(change[args[1]]??(args[1].endsWith("migrationManifest.ts")?manifest:sql))}));}
describe("computed control-only evidence",()=>{
 it("requires the complete 39-module and protected-input equality proof",()=>{expect(()=>requireControlOnlyImpact(impact)).not.toThrow();});
 it.each([{impact:"changed"},{impact:"unknown"},{protectedInputsEqual:false},{reachableModuleCount:38},{changedOutputs:["dist/auth.js"]},{moduleNames:names.slice(1)},{previousModuleNames:[...names.slice(1),"dist/different.js"]},{previousOutputFingerprint:"e".repeat(64)},{outputFingerprint:undefined}])("rejects incomplete or changed proof %j",patch=>{expect(()=>requireControlOnlyImpact({...impact,...patch})).toThrow("control_only_impact_unproven");});
 it("computes schema-compatible condition instead of accepting a skip flag",async()=>{
  const run=git(),schema=await schemaCompatibility(before,after,run);
  expect(schema.migrationCount).toBe(1);
  await expect(controlCondition(before,after,{execute:async()=>({stdout:""}),assessMcpImpact:async()=>impact,schemaCompatibility:async()=>schema})).resolves.toMatchObject({kind:"control-only",moduleCount:39,migrationCount:1});
 });
 it.each(["changed","unknown"])("%s never qualifies as control-only",async value=>{
  const compatibility=vi.fn();const operation=controlCondition(before,after,{execute:async()=>({stdout:""}),assessMcpImpact:async()=>({impact:value}),schemaCompatibility:compatibility});
  if(value==="changed")await expect(operation).resolves.toMatchObject({kind:"mcp-affecting"});else await expect(operation).rejects.toThrow("control_only_impact_unproven");
  expect(compatibility).not.toHaveBeenCalled();
 });
 it.each([
  {[after+":database/migrations/0001_example.sql"]:"changed SQL"},
  {[after+":src/database/migrationManifest.ts"]:manifest+"// changed"},
  {[after+":src/database/migrationManifest.ts"]:manifest.replace(checksum,"0".repeat(64))},
  {[after+":src/database/migrationManifest.ts"]:"export const MIGRATIONS=load();"},
  {[after+":tree"]:tree.replace("100644","120000")},
  {[after+":tree"]:""},
 ])("rejects changed/invalid migration inputs %j",async changes=>{await expect(schemaCompatibility(before,after,git(changes))).rejects.toThrow("control_only_schema_unproven");});
 it("understands the tagged literal format and helpers without executing source",async()=>{
  const tagged=manifest.replace('checksum:', 'requirement:"core",checksum:').replace('}]);','}] as const);')+'\nexport function migrationHistoryReady(){throw new Error("must_not_execute");}';
  const run=git({[before+":src/database/migrationManifest.ts"]:tagged,[after+":src/database/migrationManifest.ts"]:tagged});
  await expect(schemaCompatibility(before,after,run)).resolves.toMatchObject({migrationCount:1});
 });
 it("preserves full-source equality for metadata and helpers",async()=>{
  const tagged=manifest.replace('checksum:', 'requirement:"core",checksum:');
  for(const changed of [tagged,manifest+'\nexport function migrationHistoryReady(){return true;}'])await expect(schemaCompatibility(before,after,git({[after+":src/database/migrationManifest.ts"]:changed}))).rejects.toThrow('control_only_schema_unproven');
 });
 it.each(['unknown','CORE','optional'])('rejects unknown classification %s even in identical snapshots',async value=>{
  const tagged=manifest.replace('checksum:', `requirement:"${value}",checksum:`);await expect(schemaCompatibility(before,after,git({[before+":src/database/migrationManifest.ts"]:tagged,[after+":src/database/migrationManifest.ts"]:tagged}))).rejects.toThrow('control_only_schema_unproven');
 });
 it.each(['\nMIGRATIONS[0].requirement="billing";','\nexport const extra=true;','\nexport function unexpected(){return true;}'])('rejects extra executable top-level source %s',async extra=>{
  const source=manifest+extra;await expect(schemaCompatibility(before,after,git({[before+":src/database/migrationManifest.ts"]:source,[after+":src/database/migrationManifest.ts"]:source}))).rejects.toThrow('control_only_schema_unproven');
 });
 it("parses the actual complete authoritative manifest and checks every SQL file",async()=>{
  const source=await readFile('src/database/migrationManifest.ts','utf8');const files=source.matchAll(/file: "([a-z0-9_]+\.sql)"/g);const entries=[...files].map(x=>x[1]);
  const directory=entries.map(file=>`100644 blob ${"d".repeat(40)}\tdatabase/migrations/${file}`).join('\n');
  const run=async(_cmd:string,args:string[])=>({stdout:args[0]==='ls-tree'?directory:args[1].endsWith('migrationManifest.ts')?source:await readFile(args[1].split(':')[1],'utf8')});
  await expect(schemaCompatibility(before,after,run)).resolves.toMatchObject({migrationCount:8});
 });
 it("fails closed on missing source or failed Git inspection",async()=>{
  await expect(schemaCompatibility(before,after,async()=>{throw new Error("missing");})).rejects.toThrow("control_only_schema_unproven");
  await expect(controlCondition("missing",after)).rejects.toThrow("control_source_unknown");
 });
 it("requires explicit unambiguous traffic readback",()=>{
  expect(()=>requireControlTraffic([{revisionName:"old",weight:0},{revisionName:"new",weight:100}],"new")).not.toThrow();
  for(const traffic of [undefined,[],[{latestRevision:true,weight:100}],[{revisionName:"new",weight:50},{revisionName:"old",weight:50}],[{revisionName:"old",weight:100}]])expect(()=>requireControlTraffic(traffic,"new")).toThrow("control_traffic_unconfirmed");
 });
});
