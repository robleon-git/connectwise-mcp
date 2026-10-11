// Local operator only; no credentials/claims leave the existing OAuth helper.
import { pathToFileURL } from "node:url";
import { diagnosticMcpTarget,runDiagnostic,main as safeMain } from "../validate-mcp-user-claim.mjs";
import { matchesReadToolInventory } from "../read-only-tool-inventory.mjs";
export async function candidateDiagnostic(args,run=runDiagnostic,output=value=>console.log(value)) {
  try {
    if(args.length!==1)throw new Error();const mcpUrl=diagnosticMcpTarget(args[0]);
    if(!mcpUrl.startsWith("https://connectwise-mcp-slice3-candidate."))throw new Error();
    let safe;
    const code=await safeMain(()=>run({mcpUrl,freshLogin:true,env:{NODE_TLS_REJECT_UNAUTHORIZED:process.env.NODE_TLS_REJECT_UNAUTHORIZED}}),value=>{safe=JSON.parse(value);});
    const matched=safe.toolsListSucceeded===true&&matchesReadToolInventory(safe.toolNames);
    output(JSON.stringify({...safe,expectedReadToolSetMatched:matched}));return code||(!matched?4:0);
  }catch {output(JSON.stringify({candidateDiscoverySucceeded:false}));return 1;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await candidateDiagnostic(process.argv.slice(2));
