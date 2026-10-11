import {beforeEach,describe,expect,it,vi} from "vitest";
import {readFile} from "node:fs/promises";
// @ts-expect-error Delivery script has no declarations.
import {mcpRelease,mcpImage,candidateResource,preservedConfiguration,mcpEnvironment,acceptance,ACCEPTANCE_KEYS,operatorCidr,MCP_TARGET,MCP_CANDIDATE} from "../../scripts/deploy/mcp-release.mjs";
// @ts-expect-error Delivery script has no declarations.
import {validateEvidenceRun,requireManualMcpWorkflow,downloadEvidence} from "../../scripts/deploy/mcp-evidence-download.mjs";
// @ts-expect-error Operator script has no declarations.
import {candidateDiagnostic} from "../../scripts/deploy/diagnose-mcp-candidate.mjs";
// @ts-expect-error Operator script has no declarations.
import {diagnosticMcpTarget} from "../../scripts/validate-mcp-user-claim.mjs";
// @ts-expect-error Operator reference has no declarations.
import {EXPECTED_READ_TOOLS} from "../../scripts/read-only-tool-inventory.mjs";
import {createHash} from "node:crypto";
const sha="a".repeat(40),oldSha="b".repeat(40),digest="c".repeat(64),oldDigest="d".repeat(64);
const c={subscriptionId:"08a97e42-1e1f-4f33-95dc-36af13337091",sharedResourceGroup:"monotorr-dev-eastus-rg",resourceGroup:"monotorr-connectwise-prod-rg",registry:"monotorrdevacr6689",databaseServer:"monotorr-cw-db-01",mcpResource:"https://api.monotorr.com/mcp",controlApi:"connectwise-control-api"};
const image=`${c.registry}.azurecr.io/connectwise-mcp@sha256:${digest}`,oldImage=`${c.registry}.azurecr.io/connectwise-mcp@sha256:${oldDigest}`,controlImage=`${c.registry}.azurecr.io/connectwise-control-api@sha256:${digest}`;
const template={containers:[{image:oldImage,env:[{name:"LEGACY_PRIVATE_VALUE",value:"DO-NOT-PERSIST-SECRET"}]}]},ingress={fqdn:"pilot.example",traffic:[{latestRevision:true,weight:100}]};
const before={revision:"connectwise-mcp-pilot--0000005",image:oldImage,mode:"Single",traffic:ingress.traffic,probeCount:0,preservedFingerprint:preservedConfiguration({template,ingress}),configFingerprint:createHash("sha256").update(JSON.stringify({template,ingress})).digest("hex")};
interface State {sha:string;mcpImage:string;controlImage:string;baseline:typeof before;controlPromoted:boolean;candidate:{name:string;operatorCidr:string};acceptance?:Record<string,string|boolean>;cutoverStarted?:boolean}
let state:State;
let az=vi.fn(async(_args:string[])=>""),execute=vi.fn(async(_name:string,_args:string[])=>({stdout:""})),write=vi.fn(async(_path:string,_body:string)=>{}),smoke=vi.fn(async(_origin:string,_kind:string)=>({smokePassed:true}));
beforeEach(()=>{
 state={sha,mcpImage:image,controlImage,baseline:{...before},controlPromoted:true,candidate:{name:MCP_CANDIDATE,operatorCidr:"8.8.8.8/32"},acceptance:{...Object.fromEntries(ACCEPTANCE_KEYS.map((k:string)=>[k,true])),revision:MCP_CANDIDATE+"--candidate",image}};
 az=vi.fn(async(args:string[])=>{
  if(args.includes(MCP_TARGET)&&args.includes("show"))return JSON.stringify({...before,template,ingress});
  if(args.includes(MCP_CANDIDATE)&&args.includes("show"))return args.includes("revision")?"Healthy":JSON.stringify({mode:"Single",image,health:"Succeeded",revision:MCP_CANDIDATE+"--candidate",latest:MCP_CANDIDATE+"--candidate",env:mcpEnvironment(c),restrictions:[{ipAddressRange:"8.8.8.8/32",action:"Allow"}],domains:[]});
  if(args[0]==="resource")return "0";if(args[0]==="role")return "[]";return "";
 });
 execute=vi.fn(async(_name:string,args:string[])=>({stdout:args[0]==="status"?"":sha}));write=vi.fn(async(_path:string,_body:string)=>{});smoke=vi.fn(async(_origin:string,_kind:string)=>({smokePassed:true}));
});
function dependencies(){return {configuration:async()=>c,assertSubscription:vi.fn(),az,execute,readFile:async()=>JSON.stringify(state),writeFile:write,mkdir:vi.fn(),smoke};}
function input(action:string,extra={}){return {reviewedSha:sha,approval:`${action}:${sha}`,...extra};}
function mutations(){return az.mock.calls.map(c=>c[0] as string[]).filter(args=>args.includes("update")||args.includes("create")||args.includes("put")||args.includes("copy")||args.includes("delete")||args.includes("set"));}
describe("explicit MCP delivery boundaries",()=>{
 it("requires clean committed exact reviewed source before any Azure call",async()=>{
  await expect(mcpRelease("candidate",input("candidate",{reviewedSha:oldSha}),dependencies())).rejects.toThrow("reviewed_source_mismatch");expect(az).not.toHaveBeenCalled();
  execute.mockImplementation(async(_name,args)=>({stdout:args[0]==="status"?" M src/index.ts":sha}));
  await expect(mcpRelease("candidate",input("candidate"),dependencies())).rejects.toThrow("dirty_release_source");expect(az).not.toHaveBeenCalled();
 });
 it("build requires fresh inventory and owner baseline before publishing images",async()=>{
  await expect(mcpRelease("build",input("build"),dependencies())).rejects.toThrow("fresh_owner_and_inventory_baseline_required");expect(mutations()).toHaveLength(0);expect(execute.mock.calls.some(c=>c[0]==="docker")).toBe(false);
 });
 it("build publishes exact-source immutable MCP/control images and retains safe baseline",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>args[0]==="acr"?args.includes("digest")?"sha256:"+digest:args.includes("repository")?"false":"":original(args));
  await expect(mcpRelease("build",input("build",{ownerBaselineConnected:true,baselineReadToolsVerified:true}),dependencies())).resolves.toMatchObject({built:true});
  const builds=execute.mock.calls.filter(c=>c[0]==="docker"&&c[1][0]==="build");expect(builds).toHaveLength(2);expect(builds[0][1]).toContain("Dockerfile");expect(builds[1][1]).toContain("Dockerfile.control-plane");expect(mutations()).toHaveLength(0);
  const saved=JSON.parse(write.mock.calls[0][1]);expect(saved.mcpImage).toBe(image);expect(saved.controlImage).toBe(controlImage);expect(saved.sha).toBe(sha);expect(JSON.stringify(saved)).not.toContain("DO-NOT-PERSIST-SECRET");
 });
 it("invalid fixed linking client stops before migration or control mutation",async()=>{
  const prepare=vi.fn();await expect(mcpRelease("prepare-control",input("prepare-control",{linkingClientId:"bad client"}),{...dependencies(),controlRelease:prepare})).rejects.toThrow("fixed_linking_client_required");expect(prepare).not.toHaveBeenCalled();expect(mutations()).toHaveLength(0);
 });
 it.each(["unknown","unchanged"])("separate control promotion rejects %s MCP impact",async impact=>{
  const previousImage=controlImage;Object.assign(state,{control:{sha,image:controlImage,previousImage,previousSha:oldSha,revision:"connectwise-control-api--s3-link-"+sha.slice(0,12)}});
  await expect(mcpRelease("promote-control",input("promote-control"),{...dependencies(),assessMcpImpact:async()=>({impact})})).rejects.toThrow("explicit_mcp_impact_review_required");expect(mutations()).toHaveLength(0);
 });
 it("requires exact action-bound owner approval, not a bypass flag",async()=>{
  await expect(mcpRelease("cutover",{reviewedSha:sha,approval:`candidate:${sha}`},dependencies())).rejects.toThrow("explicit_owner_action_approval_required");expect(az).not.toHaveBeenCalled();
 });
 it.each(["Multiple",undefined])("rejects %s production revision mode",async mode=>{
  az.mockResolvedValue(JSON.stringify({...before,mode,template,ingress}));await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies())).rejects.toThrow("ambiguous_mcp_baseline");expect(mutations()).toHaveLength(0);
 });
 it("rejects stale artifacts and changed production baseline before writes",async()=>{
  state.sha=oldSha;await expect(mcpRelease("candidate",input("candidate"),dependencies())).rejects.toThrow("artifact_source_mismatch");expect(mutations()).toHaveLength(0);
  state.sha=sha;state.baseline.configFingerprint="e".repeat(64);await expect(mcpRelease("candidate",input("candidate"),dependencies())).rejects.toThrow("production_baseline_changed");expect(mutations()).toHaveLength(0);
 });
 it("candidate creation targets only the separate IP-restricted app and never assigns roles or cuts over",async()=>{
  await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies())).resolves.toMatchObject({candidateCreated:true});
  expect(mutations()).toHaveLength(1);expect(mutations()[0]).toEqual(expect.arrayContaining(["rest","--method","put","@.delivery/mcp-candidate.json"]));
  expect(mutations()[0].find(a=>a.includes("api-version="))).toBe(`/subscriptions/${c.subscriptionId}/resourceGroups/${c.resourceGroup}/providers/Microsoft.App/containerApps/${MCP_CANDIDATE}?api-version=2024-03-01`);expect(mutations()[0]).not.toContain(MCP_TARGET);
  const resource=JSON.parse(write.mock.calls.find(c=>c[0]===".delivery/mcp-candidate.json")![1]);expect(resource.properties.configuration.ingress.ipSecurityRestrictions).toEqual([{name:"operator-only",action:"Allow",ipAddressRange:"8.8.8.8/32"}]);expect(resource.properties.configuration.ingress.customDomains).toBeUndefined();
  expect(JSON.stringify(resource)).not.toMatch(/CW_MANAGE_PUBLIC_KEY|CW_MANAGE_PRIVATE_KEY|connectwise-public-key|MCP_APPROVED_USER/);
  expect(az.mock.calls.some(c=>c[0][0]==="role")).toBe(false);
 });
 it("will not overwrite a pre-existing candidate",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>args[0]==="resource"?"1":original(args));
  await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies())).rejects.toThrow("candidate_already_exists");expect(mutations()).toHaveLength(0);
 });
 it("acceptance is explicit manual evidence, cannot automatically cut over",async()=>{
  const flags=Object.fromEntries(ACCEPTANCE_KEYS.map((k:string)=>[k,true]));
  await expect(mcpRelease("accept-candidate",input("accept-candidate",{acceptance:flags}),dependencies())).resolves.toMatchObject({candidateAcceptanceRecorded:true});expect(mutations()).toHaveLength(0);
  expect(()=>acceptance({...flags,rawBody:"SECRET"})).toThrow();expect(()=>acceptance({...flags,exactReadTools:false})).toThrow();
 });
 it.each(["ownerBaselineConnected","baselineReadToolsVerified","emergencyPilotRollbackApproved"])("cutover fails without %s",async missing=>{
  const flags={ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true,[missing]:false};
  await expect(mcpRelease("cutover",input("cutover",flags),dependencies())).rejects.toThrow("fresh_cutover_owner_approval_required");expect(mutations()).toHaveLength(0);
 });
 it("missing acceptance or changed candidate fails before production mutation",async()=>{
  delete state.acceptance;await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).rejects.toThrow("candidate_acceptance_missing");expect(mutations()).toHaveLength(0);
 });
 it("cutover retains rollback evidence before its one production update, without mode/traffic/probe changes",async()=>{
  let changed=false;const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>{if(args.includes("update")){changed=true;return "";}if(changed&&args.includes(MCP_TARGET)&&args.includes("show"))return JSON.stringify({...before,image,revision:MCP_TARGET+"--s3-"+sha.slice(0,12),template,ingress});return original(args);});
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).resolves.toMatchObject({cutoverConfirmed:true});
  expect(mutations()).toHaveLength(1);const args=mutations()[0];expect(args).toContain(MCP_TARGET);expect(args).toContain(image);expect(args).not.toMatchObject(expect.arrayContaining(["--revisions-mode"]));
  expect(args).not.toContain("traffic");expect(args).not.toContain("probe");expect(args).toContain("CW_DB_USER=cw_mcp");expect(args).toContain("--remove-env-vars");
  const saved=JSON.parse(write.mock.calls[0][1]);expect(saved.cutoverStarted).toBe(true);expect(saved.baseline.image).toBe(oldImage);
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(az.mock.invocationCallOrder[az.mock.calls.findIndex(c=>c[0].includes("update"))]);expect(JSON.stringify(write.mock.calls)).not.toContain("DO-NOT-PERSIST-SECRET");
 });
 it("refuses to confirm cutover if protected probes or ingress changed",async()=>{
  let changed=false;const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>{if(args.includes("update")){changed=true;return "";}if(changed&&args.includes(MCP_TARGET)&&args.includes("show"))return JSON.stringify({...before,image,revision:MCP_TARGET+"--s3-"+sha.slice(0,12),template:{...template,containers:[{...template.containers[0],probes:[{type:"Readiness"}]}]},ingress});return original(args);});
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).rejects.toThrow("cutover_not_confirmed");
  expect(mutations()).toHaveLength(1);expect(JSON.parse(write.mock.calls[0][1]).cutoverStarted).toBe(true);
 });
 it("retains evidence on uncertain cutover failure and does not automatically retry or roll back",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>{if(args.includes("update"))throw new Error("timeout");return original(args);});
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).rejects.toThrow();expect(mutations()).toHaveLength(1);expect(JSON.parse(write.mock.calls[0][1]).cutoverStarted).toBe(true);
 });
 it("rollback copies only the recorded pilot revision/image, never deletes customer data",async()=>{
  state.cutoverStarted=true;let restored=false;const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>{if(args.includes("copy")){restored=true;return "";}if(!restored&&args.includes(MCP_TARGET)&&args.includes("show"))return JSON.stringify({...before,image,revision:MCP_TARGET+"--s3-"+sha.slice(0,12),template,ingress});return original(args);});
  await expect(mcpRelease("rollback",input("rollback",{emergencyPilotRollbackApproved:true}),dependencies())).resolves.toMatchObject({temporaryPrelaunchPilotRecovery:true});expect(mutations()).toEqual([expect.arrayContaining(["revision","copy","--from-revision",before.revision,"--image",oldImage])]);
  expect(az.mock.calls.some(c=>c[0].includes("job")||c[0].includes("keyvault")||c[0].includes("traffic"))).toBe(false);
 });
 it("cleanup refuses to delete a candidate before its separate role cleanup",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>args.includes("identity.principalId")?"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":args[0]==="role"?'["assignment"]':original(args));
  await expect(mcpRelease("cleanup",input("cleanup"),dependencies())).rejects.toThrow("candidate_role_cleanup_required");expect(mutations()).toHaveLength(0);
 });
});
describe("delivery input/provenance restrictions",()=>{
 it.each(["0.0.0.0/0","10.0.0.1/32","127.0.0.1/32","8.8.8.8/24","999.1.1.1/32","8.8.8.8/32;evil"])("rejects operator range %s",value=>expect(()=>operatorCidr(value)).toThrow());
 it("requires immutable correct-repository image and canonical candidate audience",()=>{
  expect(mcpImage(c,image)).toBe(image);expect(()=>mcpImage(c,image.replace("@sha256:",":"))).toThrow();
  const resource=candidateResource(c,image,"8.8.8.8/32");expect(resource.properties.configuration.activeRevisionsMode).toBe("Single");expect(resource.properties.template.containers[0].env).toContainEqual({name:"MCP_RESOURCE_URI",value:c.mcpResource});expect(resource.identity.type).toBe("SystemAssigned, UserAssigned");
 });
 it("requires successful same-source/repository/workflow/actor artifact provenance",async()=>{
  const valid={head_sha:sha,event:"workflow_dispatch",status:"completed",conclusion:"success",path:".github/workflows/deploy-mcp.yml",head_branch:"phase1-hardening",repository:{full_name:"robleon-git/connectwise-mcp"},actor:{login:"robleon-git"},triggering_actor:{login:"robleon-git"}};
  expect(()=>validateEvidenceRun(valid,sha)).not.toThrow();for(const patch of [{head_sha:oldSha},{conclusion:"failure"},{event:"push"},{path:".github/workflows/deploy.yml"},{head_branch:"main"},{actor:{login:"other"}}])expect(()=>validateEvidenceRun({...valid,...patch},sha)).toThrow();
  const run=vi.fn(async()=>({stdout:JSON.stringify({...valid,conclusion:"failure"})}));await expect(downloadEvidence({EVIDENCE_RUN:"123",CW_REVIEWED_SHA:sha},run)).rejects.toThrow();expect(run).toHaveBeenCalledOnce();
 });
 it("rejects direct CLI delivery outside owner manual workflow",()=>{
  const env={GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REPOSITORY:"robleon-git/connectwise-mcp",GITHUB_REF:"refs/heads/phase1-hardening",GITHUB_ACTOR:"robleon-git",GITHUB_TRIGGERING_ACTOR:"robleon-git",GITHUB_WORKFLOW:"Reviewed manual MCP delivery",CW_REVIEWED_SHA:sha,GITHUB_SHA:sha};
  expect(()=>requireManualMcpWorkflow(env)).not.toThrow();expect(()=>requireManualMcpWorkflow({...env,GITHUB_EVENT_NAME:"push"})).toThrow();
 });
 it("manual workflow retains validation/OIDC restrictions, separate actions and unchanged control guard",async()=>{
  const workflow=await readFile(".github/workflows/deploy-mcp.yml","utf8"),guard=await readFile("scripts/deploy/release.mjs","utf8");
  expect(workflow).toContain("workflow_dispatch:");expect(workflow).not.toMatch(/^ {2}(push|pull_request):/m);expect(workflow).toContain("id-token: write");expect(workflow).toContain("github.actor == 'robleon-git'");expect(workflow).toContain("github.triggering_actor == 'robleon-git'");expect(workflow).toContain("refs/heads/phase1-hardening");
  for(const gate of ["npm run build:ui","npm run build","npm run validate:ticket-card","npm run build:portal","npm run lint","npm test","npm audit --omit=dev","npm audit","git diff --check","postgres:18-alpine"])expect(workflow).toContain(gate);
  expect(guard).toContain('if (impact.impact !== "unchanged")');expect(guard).toContain("mcp_affecting_release_requires_separate_review_and_owner_dogfood");
 });
 it("candidate helper reuses OAuth/SDK and refuses arbitrary bearer destinations",async()=>{
  const url="https://connectwise-mcp-slice3-candidate.example.eastus.azurecontainerapps.io/mcp";
  expect(diagnosticMcpTarget(url)).toBe(url);for(const other of ["https://evil.example/mcp",url+"?token=secret",url.replace("https:","http:"),url.replace("candidate","pilot")])expect(()=>diagnosticMcpTarget(other)).toThrow();
  const run=vi.fn(async(_options:unknown)=>({resourceTokenVerified:true,approvedIdMatchPaths:["/sub"],mcpInitializeSucceeded:true,toolsListSucceeded:true,toolNames:EXPECTED_READ_TOOLS})),output=vi.fn();
  expect(await candidateDiagnostic([url],run,output)).toBe(0);expect(run.mock.calls[0][0]).toMatchObject({mcpUrl:url,freshLogin:true});expect(JSON.parse(output.mock.calls[0][0])).toMatchObject({toolCount:39,expectedReadToolSetMatched:true});
  run.mockClear();expect(await candidateDiagnostic(["https://evil.example/mcp"],run,output)).toBe(1);expect(run).not.toHaveBeenCalled();
 });
});
