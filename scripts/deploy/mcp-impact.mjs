import { execute } from './common.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compare executable MCP closure, not directory ownership. Unknown inputs always require MCP review.
const root = resolve('.');
const protectedFiles = ['package.json','package-lock.json','tsconfig.json','Dockerfile','.dockerignore','vite.config.ts','scripts/embed-ui.mjs'];
function protectedPath(path) {
  return protectedFiles.includes(path) || path.startsWith('ui/') || path.startsWith('scripts/build/');
}
export function mcpOutputs(snapshot) {
  const config = ts.parseConfigFileTextToJson('tsconfig.json', snapshot['tsconfig.json']);
  if (config.error || !snapshot['src/index.ts']) throw new Error('mcp_impact_unknown');
  const parsed = ts.parseJsonConfigFileContent(config.config, {...ts.sys,readDirectory:()=>[]}, root);
  if (parsed.errors.some(e=>e.code!==18003)) throw new Error('mcp_impact_unknown');
  const host = ts.createCompilerHost(parsed.options);
  const defaultRead=host.readFile,defaultExists=host.fileExists;
  const localPath=file=>relative(root,file).replaceAll('\\','/');
  const projectFile=file=>{const p=localPath(file);return !p.startsWith('../')&&!p.startsWith('node_modules/');};
  host.readFile=file=>projectFile(file)?snapshot[localPath(file)]:defaultRead(file);
  host.fileExists=file=>projectFile(file)?Object.hasOwn(snapshot,localPath(file)):defaultExists(file);
  host.getSourceFile=(file,languageVersion)=>{
    const source=host.readFile(file);return source===undefined?undefined:ts.createSourceFile(file,source,languageVersion,true);
  };
  const outputs={};
  host.writeFile=(file,content)=>{if(file.endsWith('.js')) outputs[localPath(file)]=content;};
  const program=ts.createProgram([resolve(root,'src/index.ts')],parsed.options,host);
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length) throw new Error('mcp_impact_unknown_compile_'+diagnostics.map(d=>d.code).join('_'));
  if(program.emit().emitSkipped || !outputs['dist/index.js'])throw new Error('mcp_impact_unknown');
  // Discover the executable import graph. Type-only dependencies aren't runtime inputs.
  const reachable={},pending=['dist/index.js'];
  while(pending.length){
    const name=pending.pop();if(Object.hasOwn(reachable,name))continue;
    const text=outputs[name];if(typeof text!=='string')throw new Error('mcp_impact_unknown');
    reachable[name]=text;
    const file=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    function dependency(value){
      if(!ts.isStringLiteral(value))throw new Error('mcp_impact_unknown');
      if(value.text.startsWith('.')){
        const target=relative(root,resolve(root,dirname(name),value.text)).replaceAll('\\','/');
        if(!target.startsWith('dist/')||!target.endsWith('.js'))throw new Error('mcp_impact_unknown');
        pending.push(target);
      }else if(value.text.startsWith('/')||value.text.includes(':')&&!value.text.startsWith('node:'))throw new Error('mcp_impact_unknown');
    }
    function walk(node){
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){if(node.moduleSpecifier)dependency(node.moduleSpecifier);}
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){if(node.arguments.length!==1)throw new Error('mcp_impact_unknown');dependency(node.arguments[0]);}
      // Runtime source loading/evaluation cannot be proven by an ESM closure comparison.
      if(ts.isIdentifier(node)&&['require','eval','readFile','readFileSync','createRequire','Worker'].includes(node.text))throw new Error('mcp_impact_unknown');
      ts.forEachChild(node,walk);
    }
    walk(file);
  }
  return reachable;
}
export function compareMcpSnapshots(before,after) {
  try {
    if(protectedFiles.some(path=>typeof before[path]!=='string'||typeof after[path]!=='string'))throw new Error('mcp_impact_unknown');
    for(const path of new Set([...Object.keys(before),...Object.keys(after)]))
      if(protectedPath(path)&&before[path]!==after[path])return {impact:'changed',changedOutputs:[path]};
    const oldOutput=mcpOutputs(before),newOutput=mcpOutputs(after);
    const changedOutputs=[...new Set([...Object.keys(oldOutput),...Object.keys(newOutput)])].filter(path=>oldOutput[path]!==newOutput[path]).sort();
    return {impact:changedOutputs.length?'changed':'unchanged',changedOutputs,reachableModuleCount:Object.keys(newOutput).length};
  }catch{return {impact:'unknown',changedOutputs:[]};}
}
async function snapshot(ref) {
  if(!/^[a-f0-9]{40}$/.test(ref))throw new Error('mcp_impact_unknown');
  const tree=(await execute('git',['ls-tree','-r','-z',ref],{maxBuffer:4*1024*1024})).stdout;
  const files=tree.split('\0').filter(Boolean).map(line=>{const [metadata,path]=line.split('\t');return{metadata,path};}).filter(({path})=>path.startsWith('src/')||protectedPath(path));
  if(files.some(({metadata})=>!/^100(?:644|755) blob /.test(metadata)))throw new Error('mcp_impact_unknown');
  const values=await Promise.all(files.map(async({path})=>[path,(await execute('git',['show',`${ref}:${path}`],{maxBuffer:8*1024*1024})).stdout]));
  return Object.fromEntries(values);
}
export async function assessMcpImpact(previousSha,sha) {
  try{return compareMcpSnapshots(await snapshot(previousSha),await snapshot(sha));}
  catch{return {impact:'unknown',changedOutputs:[]};}
}
// Read-only local inspection; never accepted as promotion evidence or a deployment override.
async function workingSnapshot(){
  const values={};
  async function walk(directory){for(const file of await readdir(resolve(root,directory),{withFileTypes:true})){
    const name=`${directory}/${file.name}`;if(file.isSymbolicLink())throw new Error('mcp_impact_unknown');
    if(file.isDirectory()){if(file.name!=='dist')await walk(name);}else values[name]=await readFile(resolve(root,name),'utf8');
  }}
  await walk('src');await walk('ui');await walk('scripts/build');
  for(const name of protectedFiles)values[name]=await readFile(resolve(root,name),'utf8');
  // Include the other tracked UI build inputs without reading ignored generated output.
  const names=(await execute('git',['ls-files','ui'])).stdout.trim().split('\n').filter(Boolean);
  for(const name of names)values[name]=await readFile(resolve(root,name),'utf8');
  return values;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==4)throw new Error();
    const previous=(await execute('git',['rev-parse','--verify',process.argv[2]])).stdout.trim();
    const result=process.argv[3]==='--working-tree'?compareMcpSnapshots(await snapshot(previous),await workingSnapshot()):await assessMcpImpact(previous,(await execute('git',['rev-parse','--verify',process.argv[3]])).stdout.trim());
    console.log(JSON.stringify(result));if(result.impact!=='unchanged')process.exitCode=1;
  }catch{console.log(JSON.stringify({impact:'unknown',changedOutputs:[]}));process.exitCode=1;}
}
