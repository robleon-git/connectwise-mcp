// Download only successful evidence from this repository/workflow and exact reviewed source.
import { pathToFileURL } from "node:url";
import { execute } from "./common.mjs";
export function validateEvidenceRun(value,sha) {
  if(!/^[a-f0-9]{40}$/.test(sha||"")||value?.head_sha!==sha||value?.event!=="workflow_dispatch"||value?.status!=="completed"||value?.conclusion!=="success"||
    value?.path!==".github/workflows/deploy-mcp.yml"||value?.head_branch!=="phase1-hardening"||value?.repository?.full_name!=="robleon-git/connectwise-mcp"||
    value?.actor?.login!=="robleon-git"||value?.triggering_actor?.login!=="robleon-git")throw new Error("untrusted_release_evidence");
}
export function requireManualMcpWorkflow(env) {
  if(env.GITHUB_EVENT_NAME!=="workflow_dispatch"||env.GITHUB_REPOSITORY!=="robleon-git/connectwise-mcp"||env.GITHUB_REF!=="refs/heads/phase1-hardening"||
    env.GITHUB_ACTOR!=="robleon-git"||env.GITHUB_TRIGGERING_ACTOR!=="robleon-git"||env.GITHUB_WORKFLOW!=="Reviewed manual MCP delivery"||
    !/^[a-f0-9]{40}$/.test(env.CW_REVIEWED_SHA||"")||env.CW_REVIEWED_SHA!==env.GITHUB_SHA)throw new Error("manual_reviewed_workflow_required");
}
export async function downloadEvidence(env=process.env,run=execute) {
  if(!/^[1-9][0-9]{0,19}$/.test(env.EVIDENCE_RUN||""))throw new Error("explicit_evidence_run_required");
  const value=JSON.parse((await run("gh",["api",`repos/robleon-git/connectwise-mcp/actions/runs/${env.EVIDENCE_RUN}`])).stdout);
  validateEvidenceRun(value,env.CW_REVIEWED_SHA);
  await run("gh",["run","download",env.EVIDENCE_RUN,"--repo","robleon-git/connectwise-mcp","--name","slice3-mcp-release","--dir",".delivery"]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await downloadEvidence();}catch{console.error(JSON.stringify({releaseEvidenceDownloaded:false}));process.exitCode=1;}}
