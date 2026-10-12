import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
// @ts-expect-error Local operator script has no declarations.
import {compareMcpSnapshots,mcpOutputs,assessMcpImpact} from '../../scripts/deploy/mcp-impact.mjs';
function fixture() {
 return {'package.json':'{"type":"module"}','package-lock.json':'locked','Dockerfile':'CMD ["node","dist/index.js"]','.dockerignore':'dist','vite.config.ts':'same','scripts/embed-ui.mjs':'same',
  'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',rootDir:'src',outDir:'dist',skipLibCheck:true,types:[]}}),
  'src/index.ts':'import {CwManageClient} from "./api-client.js"; export const client = new CwManageClient();',
  'src/api-client.ts':'export class CwManageClient { get() { return "GET"; } }',
  'src/connections/service.ts':'export const service = "control-only";'};
}
describe('executable MCP closure comparison',()=>{
 it('proves equality of all 39 executable module names, contents and protected inputs',()=>{
  const before:Record<string,string>=fixture();before['src/index.ts']=Array.from({length:38},(_,i)=>`export {v${i}} from "./module-${i}.js";`).join('\n');
  for(let i=0;i<38;i++)before[`src/module-${i}.ts`]=`export const v${i}=${i};`;
  const proof=compareMcpSnapshots(before,{...before,'src/connections/service.ts':'export const changed=true;'});
  expect(proof).toMatchObject({impact:'unchanged',reachableModuleCount:39,protectedInputsEqual:true,changedOutputs:[]});expect(proof.moduleNames).toHaveLength(39);expect(proof.previousModuleNames).toEqual(proof.moduleNames);expect(proof.previousOutputFingerprint).toBe(proof.outputFingerprint);
 });
 it('does not classify unreachable control/account/connection modules as deployed MCP code',()=>{
  const before=fixture(),after={...before,'src/connections/service.ts':'export const service = "changed control";','src/control-plane/index.ts':'export const control = "changed";'};
  expect(compareMcpSnapshots(before,after)).toMatchObject({impact:'unchanged',changedOutputs:[]});
 });
 it('allows a shared-client type-only change only when emitted MCP JS is identical',()=>{
  const before=fixture(),after={...before,'src/api-client.ts':'export type ControlConfig = {accountId:string};\n'+before['src/api-client.ts']};
  expect(compareMcpSnapshots(before,after)).toMatchObject({impact:'unchanged',changedOutputs:[]});
 });
 it.each(['src/index.ts','src/api-client.ts'])('blocks an executable change to %s',file=>{
  const before=fixture(),after={...before,[file]:before[file as keyof typeof before]+'\nexport const behaviorChange=true;'};
  expect(compareMcpSnapshots(before,after).impact).toBe('changed');
 });
 it.each(['auth','tools'])('blocks reachable MCP %s changes',area=>{
  const before={...fixture(),'src/index.ts':`import {run} from "./${area}/handler.js"; export {run};`,[`src/${area}/handler.ts`]:'export const run=()=>true;'};
  expect(compareMcpSnapshots(before,{...before,[`src/${area}/handler.ts`]:'export const run=()=>false;'}).impact).toBe('changed');
 });
 it.each(['package-lock.json','package.json','Dockerfile','.dockerignore','tsconfig.json','vite.config.ts','scripts/build/ticket-card-inline.mjs'])('blocks changed dependency/build input %s',file=>{
  const before=fixture();expect(compareMcpSnapshots(before,{...before,[file]:'changed'}).impact).toBe('changed');
 });
 it.each(['const target="./api-client.js";export const load=()=>import(target);','import {missing} from "./absent.js";export {missing};','export const value: string=123;','export const source = eval("true");'])('fails closed on unsupported/invalid impact',source=>{
  const before=fixture();expect(compareMcpSnapshots(before,{...before,'src/index.ts':source}).impact).toBe('unknown');
 });
 it('fails closed on missing baseline inputs or unavailable Git revisions',async()=>{
  const before=fixture();const missing={...before};delete (missing as Record<string,string>)['Dockerfile'];expect(compareMcpSnapshots(missing,before).impact).toBe('unknown');
  expect((await assessMcpImpact('not-a-sha','also-not-a-sha')).impact).toBe('unknown');
 });
 it('includes relative reexports and literal dynamic imports in the closure',()=>{
  const before={...fixture(),'src/index.ts':'export {run} from "./auth/handler.js";export const load=()=>import("./tools/read.js");','src/auth/handler.ts':'export const run=()=>true;','src/tools/read.ts':'export const read=()=>true;'};
  expect(Object.keys(mcpOutputs(before)).sort()).toEqual(['dist/auth/handler.js','dist/index.js','dist/tools/read.js']);
  expect(compareMcpSnapshots(before,{...before,'src/tools/read.ts':'export const read=()=>false;'}).impact).toBe('changed');
 });
 it('requires locked dependencies in delivery before the compiler-based gate',async()=>{
  const workflow=await readFile(new URL('../../.github/workflows/deploy.yml',import.meta.url),'utf8');
  expect(workflow).toContain('Install locked delivery dependencies');
  expect(workflow.indexOf('Install locked delivery dependencies')).toBeLessThan(workflow.indexOf('Control API artifact and release'));
 });
});
