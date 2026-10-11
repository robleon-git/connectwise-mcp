// Local read-only operator collector. No OAuth flow and no raw Azure output.
import { pathToFileURL } from "node:url";
import { retrieveAzureDiagnostics,safeAzureEvent } from "../diagnose-live-mcp.mjs";
export async function collectAccessEvidence(args,retrieve=retrieveAzureDiagnostics,output=value=>console.log(value)) {
  if(args.length!==1||!["production","candidate"].includes(args[0])){output(JSON.stringify({accessEvidenceRetrieved:false,reason:"invalid_target"}));return 1;}
  let logs;try{logs=await retrieve(undefined,{candidate:args[0]==="candidate"});}catch{logs={status:"unavailable",events:[]};}
  const events=(Array.isArray(logs.events)?logs.events:[]).map(safeAzureEvent).filter(event=>event?.event==="mcp.access_evidence");
  for(const event of events)output(JSON.stringify(event));
  output(JSON.stringify({accessEvidenceRetrieved:logs.status==="retrieved",structuredEventsFound:events.length>0,eventCount:events.length}));
  return events.length?0:2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)process.exitCode=await collectAccessEvidence(process.argv.slice(2));
