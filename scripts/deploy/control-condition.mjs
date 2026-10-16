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
// Read immutable source as literal data; never evaluate a previous artifact's JavaScript.
export async function readMigrationContract(ref, run = execute) {
  try {
    if (!shaPattern.test(ref || "")) throw new Error();
    const lines = (await run("git", ["ls-tree", "-r", ref, "--", "database/migrations"])).stdout.trim().split("\n");
    if (!lines.length || lines.some(line => !/^100(?:644|755) blob [a-f0-9]{40}\tdatabase\/migrations\/[0-9]{4}_[a-z_]+\.sql$/.test(line))) throw new Error();
    const files = {};
    for (const line of lines) { const path = line.split("\t")[1]; files[path] = (await run("git", ["show", `${ref}:${path}`])).stdout; }
    const manifest = (await run("git", ["show", `${ref}:src/database/migrationManifest.ts`])).stdout;
    const source = ts.createSourceFile("manifest.ts", manifest, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw new Error();
    const helpers = new Set(["validateMigrationManifest", "requiredMigrations", "validateMigrationHistory", "migrationHistoryReady", "migrationReadiness",
      "validateCompatibilityCatalog", "validateRuntimeMigrationHistory"]);
    const types = new Set(["MigrationRequirement", "Migration", "MigrationHistoryReader", "CompatibleMigration"]);
    const data = {};
    for (const [index, statement] of source.statements.entries()) {
      if (ts.isVariableStatement(statement)) {
        if (!(statement.declarationList.flags & ts.NodeFlags.Const) || !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || statement.declarationList.declarations.length !== 1) throw new Error();
        const declaration = statement.declarationList.declarations[0], name = declaration.name.getText(source), init = declaration.initializer;
        if (!["MIGRATIONS", "FORWARD_COMPATIBILITY"].includes(name) || Object.hasOwn(data, name) || index === 0 && name !== "MIGRATIONS" ||
          !init || !ts.isCallExpression(init) || init.expression.getText(source) !== "Object.freeze" || init.arguments.length !== 1) throw new Error();
        let array = init.arguments[0];
        if (ts.isAsExpression(array) && array.type.getText(source) === "const") array = array.expression;
        if (!ts.isArrayLiteralExpression(array)) throw new Error();
        data[name] = array.elements.map(element => {
          if (!ts.isObjectLiteralExpression(element)) throw new Error();
          const item = {};
          for (const prop of element.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isStringLiteral(prop.initializer)) throw new Error();
            const key = prop.name.getText(source);
            if (!["id", "file", "checksum", "requirement"].includes(key) || Object.hasOwn(item, key)) throw new Error();
            item[key] = prop.initializer.text;
          }
          return item;
        });
      } else {
        const allowed = ts.isFunctionDeclaration(statement) ? helpers.delete(statement.name?.text) :
          (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && types.delete(statement.name.text);
        if (!allowed) throw new Error();
      }
    }
    const execution = data.MIGRATIONS, catalog = data.FORWARD_COMPATIBILITY ?? [];
    if (!Array.isArray(execution) || !execution.length || execution.length !== lines.length) throw new Error();
    let previous = "", format;
    for (const item of execution) {
      const keys = Object.keys(item).sort().join(","), sql = files[`database/migrations/${item.file}`];
      if (!["checksum,file,id", "checksum,file,id,requirement"].includes(keys) || format && format !== keys ||
        !/^[0-9]{4}_[a-z_]+$/.test(item.id || "") || item.id <= previous || item.file !== item.id + ".sql" ||
        !/^[a-f0-9]{64}$/.test(item.checksum || "") || typeof sql !== "string" || createHash("sha256").update(sql).digest("hex") !== item.checksum ||
        keys.includes("requirement") && !["core", "billing"].includes(item.requirement)) throw new Error();
      previous = item.id; format = keys;
    }
    let highest = Math.max(...execution.map(item => Number(item.id.slice(0, 4))));
    for (const item of catalog) {
      if (Object.keys(item).sort().join(",") !== "checksum,id" || !/^[0-9]{4}_[a-z_]+$/.test(item.id || "") ||
        Number(item.id.slice(0, 4)) <= highest || !/^[a-f0-9]{64}$/.test(item.checksum || "")) throw new Error();
      highest = Number(item.id.slice(0, 4));
    }
    return { manifest, files, count: execution.length, execution, catalog };
  } catch { throw new Error("migration_contract_unproven"); }
}
export async function schemaCompatibility(previousSha, sha, run = execute) {
  try {
    const before = await readMigrationContract(previousSha, run), after = await readMigrationContract(sha, run);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error();
    return { migrationCount: after.count, migrationFingerprint: createHash("sha256").update(JSON.stringify(after)).digest("hex") };
  } catch { throw new Error("control_only_schema_unproven"); }
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
