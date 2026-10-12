// Computed evidence only: never accept a caller-provided skip-migration flag.
import { createHash } from "node:crypto";
import ts from "typescript";
import { execute } from "./common.mjs";
import { assessMcpImpact } from "./mcp-impact.mjs";
const shaPattern=/^[a-f0-9]{40}$/;
export function requireControlOnlyImpact(impact) {
  if(impact?.impact!=="unchanged"||impact.protectedInputsEqual!==true||impact.reachableModuleCount!==39||
    !Array.isArray(impact.changedOutputs)||impact.changedOutputs.length||!Array.isArray(impact.moduleNames)||!Array.isArray(impact.previousModuleNames)||
    impact.moduleNames.length!==39||new Set(impact.moduleNames).size!==39||JSON.stringify(impact.moduleNames)!==JSON.stringify(impact.previousModuleNames)||
    !/^[a-f0-9]{64}$/.test(impact.outputFingerprint||"")||impact.outputFingerprint!==impact.previousOutputFingerprint)
    throw new Error("control_only_impact_unproven");
}
export async function schemaCompatibility(previousSha,sha,run=execute) {
  try {
    if(!shaPattern.test(previousSha)||!shaPattern.test(sha))throw new Error();
    const snapshot=async ref=>{
      const tree=(await run("git",["ls-tree","-r",ref,"--","database/migrations"])).stdout.trim().split("\n");
      if(!tree.length||tree.some(line=>!/^100(?:644|755) blob [a-f0-9]{40}\tdatabase\/migrations\/[0-9]{4}_[a-z_]+\.sql$/.test(line)))throw new Error();
      const files={};
      for(const line of tree){const path=line.split("\t")[1];files[path]=(await run("git",["show",`${ref}:${path}`])).stdout;}
      const manifest=(await run("git",["show",`${ref}:src/database/migrationManifest.ts`])).stdout;
      const source=ts.createSourceFile("manifest.ts",manifest,ts.ScriptTarget.Latest,true);
      if(source.statements.length!==1||!ts.isVariableStatement(source.statements[0]))throw new Error();
      const declarations=source.statements[0].declarationList.declarations;
      const declaration=declarations[0], init=declaration?.initializer;
      if(declarations.length!==1||declaration.name.getText(source)!=="MIGRATIONS"||!init||!ts.isCallExpression(init)||init.expression.getText(source)!=="Object.freeze"||init.arguments.length!==1||!ts.isArrayLiteralExpression(init.arguments[0]))throw new Error();
      const ids=new Set();
      for(const element of init.arguments[0].elements){
        if(!ts.isObjectLiteralExpression(element)||element.properties.length!==3)throw new Error();
        const item={};
        for(const property of element.properties){if(!ts.isPropertyAssignment(property)||!ts.isStringLiteral(property.initializer))throw new Error();const key=property.name.getText(source);if(!["id","file","checksum"].includes(key)||Object.hasOwn(item,key))throw new Error();item[key]=property.initializer.text;}
        const sql=files[`database/migrations/${item.file}`];
        if(!/^[0-9]{4}_[a-z_]+$/.test(item.id||"")||item.file!==item.id+".sql"||ids.has(item.id)||typeof sql!=="string"||createHash("sha256").update(sql).digest("hex")!==item.checksum)throw new Error();ids.add(item.id);
      }
      if(ids.size!==tree.length||!ids.size)throw new Error();
      return {manifest,files,count:ids.size};
    };
    const before=await snapshot(previousSha),after=await snapshot(sha);
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error();
    return {migrationCount:after.count,migrationFingerprint:createHash("sha256").update(JSON.stringify(after)).digest("hex")};
  }catch{throw new Error("control_only_schema_unproven");}
}
export async function controlCondition(previousSha,sha,dependencies={}) {
  if(!shaPattern.test(previousSha||"")||!shaPattern.test(sha||""))throw new Error("control_source_unknown");
  await (dependencies.execute||execute)("git",["merge-base","--is-ancestor",previousSha,sha]);
  const impact=await (dependencies.assessMcpImpact||assessMcpImpact)(previousSha,sha);
  if(impact?.impact==="changed")return {kind:"mcp-affecting",previousSha,sha};
  requireControlOnlyImpact(impact);
  const schema=await (dependencies.schemaCompatibility||schemaCompatibility)(previousSha,sha);
  return {kind:"control-only",previousSha,sha,moduleCount:39,moduleFingerprint:impact.outputFingerprint,protectedInputsEqual:true,...schema};
}
export function requireControlTraffic(traffic,revision) {
  if(!Array.isArray(traffic)||!traffic.length||traffic.some(t=>!Number.isInteger(t.weight)||t.weight<0||t.weight>100||t.latestRevision===true)||
    traffic.reduce((sum,t)=>sum+t.weight,0)!==100||traffic.filter(t=>t.weight>0).length!==1||traffic.find(t=>t.weight>0)?.revisionName!==revision)
    throw new Error("control_traffic_unconfirmed");
}
export async function readControlTraffic(call,target,revision) {
  const traffic=JSON.parse(await call(["containerapp","show",...target,"--query","properties.configuration.ingress.traffic","-o","json"]));
  requireControlTraffic(traffic,revision);
}
