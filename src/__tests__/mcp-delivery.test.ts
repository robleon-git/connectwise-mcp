import {beforeEach,describe,expect,it,vi} from "vitest";
import {readFile} from "node:fs/promises";
// @ts-expect-error Delivery script has no declarations.
import {mcpRelease,canonicalJson,semanticProjection,configurationFingerprint,FINGERPRINT_VERSION,BASELINE_API_VERSION,READINESS_TIMEOUT_MS,READINESS_INTERVAL_MS,revisionTemplateFingerprint,mcpImage,candidateResource,preservedConfiguration,mcpEnvironment,acceptance,ACCEPTANCE_KEYS,operatorCidr,MCP_TARGET,MCP_CANDIDATE} from "../../scripts/deploy/mcp-release.mjs";
// @ts-expect-error Delivery script has no declarations.
import {validateEvidenceRun,requireManualMcpWorkflow,downloadEvidence} from "../../scripts/deploy/mcp-evidence-download.mjs";
// @ts-expect-error Operator script has no declarations.
import {candidateDiagnostic} from "../../scripts/deploy/diagnose-mcp-candidate.mjs";
// @ts-expect-error Operator script has no declarations.
import {diagnosticMcpTarget} from "../../scripts/validate-mcp-user-claim.mjs";
// @ts-expect-error Operator reference has no declarations.
import {EXPECTED_READ_TOOLS} from "../../scripts/read-only-tool-inventory.mjs";
// @ts-expect-error Delivery script has no declarations.
import { releaseDiagnostic, releaseFailure } from "../../scripts/deploy/mcp-release-diagnostics.mjs";
const sha="a".repeat(40),oldSha="b".repeat(40),digest="c".repeat(64),oldDigest="d".repeat(64);
const c={subscriptionId:"08a97e42-1e1f-4f33-95dc-36af13337091",sharedResourceGroup:"monotorr-dev-eastus-rg",resourceGroup:"monotorr-connectwise-prod-rg",registry:"monotorrdevacr6689",databaseServer:"monotorr-cw-db-01",mcpResource:"https://api.monotorr.com/mcp",controlApi:"connectwise-control-api"};
const image=`${c.registry}.azurecr.io/connectwise-mcp@sha256:${digest}`,oldImage=`${c.registry}.azurecr.io/connectwise-mcp@sha256:${oldDigest}`,controlImage=`${c.registry}.azurecr.io/connectwise-control-api@sha256:${digest}`;
const template={containers:[{image:oldImage,env:[{name:"LEGACY_PRIVATE_VALUE",value:"DO-NOT-PERSIST-SECRET"}]}]},ingress={fqdn:"pilot.example",traffic:[{latestRevision:true,weight:100}]};
const before={fingerprintVersion:FINGERPRINT_VERSION,revision:"connectwise-mcp-pilot--0000005",image:oldImage,mode:"Single",traffic:ingress.traffic,probeCount:0,preservedFingerprint:preservedConfiguration({template,ingress}),configFingerprint:configurationFingerprint({template,ingress})};
interface State {fingerprintVersion:string;sha:string;mcpImage:string;controlImage:string;baseline:typeof before;controlPromoted:boolean;candidate:{name:string;operatorCidr:string};acceptance?:Record<string,string|boolean>;cutoverStarted?:boolean}
let state:State;
let az=vi.fn(async(_args:string[])=>""),execute=vi.fn(async(_name:string,_args:string[])=>({stdout:""})),write=vi.fn(async(_path:string,_body:string)=>{}),smoke=vi.fn(async(_origin:string,_kind:string)=>({smokePassed:true}));
beforeEach(()=>{
 state={fingerprintVersion:FINGERPRINT_VERSION,sha,mcpImage:image,controlImage,baseline:{...before},controlPromoted:true,candidate:{name:MCP_CANDIDATE,operatorCidr:"8.8.8.8/32"},acceptance:{...Object.fromEntries(ACCEPTANCE_KEYS.map((k:string)=>[k,true])),revision:MCP_CANDIDATE+"--candidate",image}};
 az=vi.fn(async(args:string[])=>{
  if(productionRead(args))return productionArm();
  const selected=revisionRead(args);
  if(selected)return revisionArm(selected);
  if(args.some(a=>a.endsWith(`/containerApps/${MCP_TARGET}/revisions?api-version=${BASELINE_API_VERSION}`)))return JSON.stringify({value:[]});
  if(args.includes(MCP_CANDIDATE)&&args.includes("show"))return args.includes("revision")?"Healthy":JSON.stringify({mode:"Single",image,health:"Succeeded",revision:MCP_CANDIDATE+"--candidate",latest:MCP_CANDIDATE+"--candidate",env:mcpEnvironment(c),restrictions:[{ipAddressRange:"8.8.8.8/32",action:"Allow"}],domains:[]});
  if(args[0]==="resource")return "0";if(args[0]==="role")return "[]";return "";
 });
 execute=vi.fn(async(_name:string,args:string[])=>({stdout:args[0]==="status"?"":sha}));write=vi.fn(async(_path:string,_body:string)=>{});smoke=vi.fn(async(_origin:string,_kind:string)=>({smokePassed:true}));
});
function productionRead(args:string[]) {return args[0]==="rest"&&args.includes("get")&&args.some(a=>a.endsWith(`/containerApps/${MCP_TARGET}?api-version=${BASELINE_API_VERSION}`));}
function productionArm(patch:Record<string,unknown>={}) {
 const v={...before,template,ingress,identity:undefined,...patch};
 return JSON.stringify({identity:v.identity,properties:{latestReadyRevisionName:v.revision,
   latestRevisionName:(patch.latest as string)||v.revision,configuration:{activeRevisionsMode:v.mode,ingress:v.ingress},template:{...v.template,containers:v.template.containers.map(c=>({...c,image:v.image}))}}});
}
function revisionRead(args:string[]) {
 const url=args.find(a=>a.includes(`/containerApps/${MCP_TARGET}/revisions/`));
 return url?.split("/revisions/")[1].split("?")[0];
}
function revisionArm(name:string,patch:Record<string,unknown>={}) {
 const selectedImage=name.includes("--s3-")&&!name.includes("--s3-recovery-")?image:oldImage;
 return JSON.stringify({name,properties:{active:true,healthState:"Healthy",provisioningState:"Provisioned",runningState:"RunningAtMaxScale",
  template:{...template,containers:template.containers.map(c=>({...c,image:selectedImage}))},...patch}});
}
function dependencies(){return {configuration:async()=>c,assertSubscription:vi.fn(),az,execute,readFile:async()=>JSON.stringify(state),writeFile:write,mkdir:vi.fn(),smoke};}
function input(action:string,extra={}){return {reviewedSha:sha,approval:`${action}:${sha}`,...extra};}
function mutations(){return az.mock.calls.map(c=>c[0] as string[]).filter(args=>args.includes("update")||args.includes("create")||args.includes("put")||args.includes("copy")||args.includes("delete")||args.includes("set"));}
const moduleNames=Array.from({length:39},(_,i)=>`dist/module-${i}.js`);
const unchangedImpact={impact:"unchanged",changedOutputs:[],reachableModuleCount:39,moduleNames,previousModuleNames:moduleNames,protectedInputsEqual:true,outputFingerprint:digest,previousOutputFingerprint:digest};
const schema={migrationCount:4,migrationFingerprint:oldDigest};
function controlState(){
 const revision="connectwise-control-api--s3-link-"+sha.slice(0,12),previousRevision="connectwise-control-api--prior";
 const condition={kind:"control-only",previousSha:oldSha,sha,moduleCount:39,moduleFingerprint:digest,protectedInputsEqual:true,...schema};
 Object.assign(state,{controlPromoted:false,control:{sha,image:controlImage,previousImage:controlImage,previousSha:oldSha,previousRevision,revision,condition}});
 let traffic=[{revisionName:previousRevision,weight:100}];
 const original=az.getMockImplementation()!;
 az.mockImplementation(async args=>{
  if(args.includes(c.controlApi)){
   if(args.includes("traffic")&&args.includes("set")){traffic=[{revisionName:args[args.indexOf("--revision-weight")+1].split("=")[0],weight:100}];return "";}
   if(args.includes("revision")&&args.includes("show"))return JSON.stringify({health:"Healthy",active:true,image:controlImage,fqdn:"connectwise-control-api--candidate.domain.eastus.azurecontainerapps.io"});
   if(args.includes("show"))return args.some(a=>a==="properties.configuration.ingress.traffic")?JSON.stringify(traffic):JSON.stringify({mode:"Multiple",fqdn:"connectwise-control-api.domain.eastus.azurecontainerapps.io",traffic});
  }
  return original(args);
 });
 return {revision,previousRevision};
}
function controlDependencies(){return {...dependencies(),assessMcpImpact:async()=>unchangedImpact,schemaCompatibility:async()=>schema};}
describe("computed Slice 3 control-only promotion",()=>{
 it.each(["candidate","cutover"])("control-only approval cannot authorize MCP %s",async action=>{
  controlState();await expect(mcpRelease(action,input("promote-control"),controlDependencies())).rejects.toThrow("explicit_owner_action_approval_required");expect(mutations()).toHaveLength(0);
 });
 it("promotes unchanged 39-module MCP proof without altering acceptance or either MCP application",async()=>{
  const {revision}=controlState(),accepted=structuredClone(state.acceptance),baseline=structuredClone(state.baseline),candidate=structuredClone(state.candidate);
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).resolves.toMatchObject({controlPromoted:true});
  const saved=JSON.parse(write.mock.calls.at(-1)![1]);expect(saved.acceptance).toEqual(accepted);expect(saved.baseline).toEqual(baseline);expect(saved.candidate).toEqual(candidate);
  expect(mutations().every(args=>args.includes(c.controlApi)&&!args.includes(MCP_TARGET)&&!args.includes(MCP_CANDIDATE))).toBe(true);
  expect(mutations().at(-1)).toContain(`${revision}=100`);
 });
 it.each(["changed","unknown"])("%s inputs cannot use recorded control-only evidence",async impact=>{
  controlState();await expect(mcpRelease("promote-control",input("promote-control"),{...controlDependencies(),assessMcpImpact:async()=>({impact})})).rejects.toThrow();expect(mutations()).toHaveLength(0);
 });
 it("preparation preserves MCP evidence and invalidates stale control promotion on failure",async()=>{
  controlState();state.controlPromoted=true;const accepted=structuredClone(state.acceptance);
  const prepare=vi.fn(async(action:string)=>{expect(action).toBe("prepare-slice3");throw new Error("compatibility failed");});
  await expect(mcpRelease("prepare-control",input("prepare-control",{linkingClientId:"approved-public-client"}),{...dependencies(),controlRelease:prepare})).rejects.toThrow("compatibility failed");
  const saved=JSON.parse(write.mock.calls[0][1]);expect(saved.controlPromoted).toBe(false);expect(saved.acceptance).toEqual(accepted);expect(saved.candidate).toEqual(state.candidate);expect(saved.baseline).toEqual(state.baseline);expect(mutations()).toHaveLength(0);
 });
 it("changed schema stops before mutations",async()=>{
  controlState();await expect(mcpRelease("promote-control",input("promote-control"),{...controlDependencies(),schemaCompatibility:async()=>({...schema,migrationCount:5})})).rejects.toThrow("control_only_evidence_mismatch");expect(mutations()).toHaveLength(0);
 });
 it("missing preparation proof and wrong candidate readiness fail before traffic mutation",async()=>{
  controlState();delete (state as unknown as {control:{condition?:object}}).control.condition;
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow("control_only_evidence_mismatch");expect(mutations()).toHaveLength(0);
  controlState();let checks=0;smoke.mockImplementation(async()=>{if(++checks===2)throw new Error("candidate not ready");return {smokePassed:true};});
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow("candidate not ready");expect(mutations()).toHaveLength(0);
 });
 it("ambiguous promoted traffic triggers verified rollback",async()=>{
  const {previousRevision,revision}=controlState();const original=az.getMockImplementation()!;let newTraffic=false;
  az.mockImplementation(async args=>{
   if(args.includes("traffic")&&args.includes("set"))newTraffic=args.includes(`${revision}=100`);
   if(newTraffic&&args.includes("properties.configuration.ingress.traffic"))return JSON.stringify([{latestRevision:true,weight:100}]);
   return original(args);
  });
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow("control_traffic_unconfirmed");expect(mutations().at(-1)).toContain(`${previousRevision}=100`);expect(write).not.toHaveBeenCalled();
 });
 it("failed rollback fails closed without marking promotion complete",async()=>{
  const {previousRevision,revision}=controlState();const original=az.getMockImplementation()!;let attempted=false;
  az.mockImplementation(async args=>{if(args.includes(`${revision}=100`)){attempted=true;throw new Error("promotion timeout");}if(attempted&&args.includes(`${previousRevision}=100`))throw new Error("rollback failed");return original(args);});
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow("rollback failed");expect(write).not.toHaveBeenCalled();
 });
 it("retains the changed-impact MCP-affecting lane",async()=>{
  controlState();Object.assign(state,{control:{...(state as unknown as {control:object}).control,condition:{kind:"mcp-affecting",previousSha:oldSha,sha}}});
  await expect(mcpRelease("promote-control",input("promote-control"),{...dependencies(),assessMcpImpact:async()=>({impact:"changed"})})).resolves.toMatchObject({controlPromoted:true});
 });
 it("schema readiness is not candidate acceptance or cutover authorization",async()=>{
  state.acceptance=undefined;
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).rejects.toThrow("candidate_acceptance_missing");
  expect(mutations()).toHaveLength(0);
 });
 it("ambiguous initial traffic fails before mutation",async()=>{
  controlState();const original=az.getMockImplementation()!;az.mockImplementation(async args=>args.includes(c.controlApi)&&args.includes("show")&&!args.includes("revision")?JSON.stringify({mode:"Multiple",fqdn:"control.invalid",traffic:[{latestRevision:true,weight:100}]}):original(args));
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow("control_traffic_unconfirmed");expect(mutations()).toHaveLength(0);
 });
 it("failed post-promotion smoke restores the recorded prior revision and does not mark promotion complete",async()=>{
  const {previousRevision}=controlState();smoke.mockRejectedValueOnce(new Error("current not ready"));
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow();expect(mutations()).toHaveLength(0);
  smoke.mockReset();let checks=0;smoke.mockImplementation(async()=>{if(++checks===4)throw new Error("new failed");return {smokePassed:true};});
  await expect(mcpRelease("promote-control",input("promote-control"),controlDependencies())).rejects.toThrow("new failed");
  expect(mutations().at(-1)).toContain(`${previousRevision}=100`);expect(write).not.toHaveBeenCalled();
 });
});
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
  await expect(mcpRelease("promote-control",input("promote-control"),{...dependencies(),assessMcpImpact:async()=>({impact})})).rejects.toThrow("control_only_impact_unproven");expect(mutations()).toHaveLength(0);
 });
 it("requires exact action-bound owner approval, not a bypass flag",async()=>{
  await expect(mcpRelease("cutover",{reviewedSha:sha,approval:`candidate:${sha}`},dependencies())).rejects.toThrow("explicit_owner_action_approval_required");expect(az).not.toHaveBeenCalled();
 });
 it.each(["Multiple",undefined])("rejects %s production revision mode",async mode=>{
  az.mockResolvedValue(productionArm({mode}));await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies())).rejects.toThrow("ambiguous_mcp_baseline");expect(mutations()).toHaveLength(0);
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
  az.mockImplementation(async args=>{if(args.includes("update")){changed=true;return "";}if(changed&&productionRead(args))return productionArm({image,revision:MCP_TARGET+"--s3-"+sha.slice(0,12)});return original(args);});
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).resolves.toMatchObject({cutoverConfirmed:true});
  expect(mutations()).toHaveLength(1);const args=mutations()[0];expect(args).toContain(MCP_TARGET);expect(args).toContain(image);expect(args).not.toMatchObject(expect.arrayContaining(["--revisions-mode"]));
  expect(args).not.toContain("traffic");expect(args).not.toContain("probe");expect(args).toContain("CW_DB_USER=cw_mcp");expect(args).toContain("--remove-env-vars");
  const saved=JSON.parse(write.mock.calls[0][1]);expect(saved.cutoverStarted).toBe(true);expect(saved.baseline.image).toBe(oldImage);
  expect(write.mock.invocationCallOrder[0]).toBeLessThan(az.mock.invocationCallOrder[az.mock.calls.findIndex(c=>c[0].includes("update"))]);expect(JSON.stringify(write.mock.calls)).not.toContain("DO-NOT-PERSIST-SECRET");
 });
 it("refuses to confirm cutover if protected probes or ingress changed",async()=>{
  let changed=false;const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>{if(args.includes("update")){changed=true;return "";}if(changed&&productionRead(args))return productionArm({image,revision:MCP_TARGET+"--s3-"+sha.slice(0,12),template:{...template,containers:[{...template.containers[0],probes:[{type:"Readiness"}]}]}});return original(args);});
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).rejects.toThrow("unexpected_runtime_stop_for_operator_review");
  expect(mutations()).toHaveLength(1);expect(JSON.parse(write.mock.calls[0][1]).cutoverStarted).toBe(true);
 });
 it("retains evidence on uncertain cutover failure and does not automatically retry or roll back",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>{if(args.includes("update"))throw new Error("timeout");return original(args);});
  await expect(mcpRelease("cutover",input("cutover",{ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true}),dependencies())).rejects.toThrow();expect(mutations()).toHaveLength(1);expect(JSON.parse(write.mock.calls[0][1]).cutoverStarted).toBe(true);
 });
 it("rollback copies only the recorded pilot revision/image, never deletes customer data",async()=>{
  state.cutoverStarted=true;let restored=false;const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>{if(args.includes("copy")){restored=true;return "";}if(productionRead(args))return productionArm(restored?{revision:MCP_TARGET+"--s3-recovery-"+sha.slice(0,12)}:{image,revision:MCP_TARGET+"--s3-"+sha.slice(0,12)});return original(args);});
  await expect(mcpRelease("rollback",input("rollback",{emergencyPilotRollbackApproved:true}),dependencies())).resolves.toMatchObject({temporaryPrelaunchPilotRecovery:true});expect(mutations()).toEqual([expect.arrayContaining(["revision","copy","--from-revision",before.revision])]);expect(mutations()[0]).not.toContain("--image");expect(mutations()[0]).not.toContain(oldImage);
  expect(az.mock.calls.some(c=>c[0].includes("job")||c[0].includes("keyvault")||c[0].includes("traffic"))).toBe(false);
 });
 it("cleanup refuses to delete a candidate before its separate role cleanup",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>args.includes("identity.principalId")?"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":args[0]==="role"?'["assignment"]':original(args));
  await expect(mcpRelease("cleanup",input("cleanup"),dependencies())).rejects.toThrow("candidate_role_cleanup_required");expect(mutations()).toHaveLength(0);
 });
});
describe("canonical semantic release baseline",()=>{
 const driftCases:[string,Record<string,unknown>][]=[
  ["image",{image}], ["revision",{revision:MCP_TARGET+"--other"}], ["mode",{mode:"Multiple"}],
  ["traffic",{ingress:{...ingress,traffic:[{latestRevision:true,weight:50}]}}],
  ["identity",{identity:{type:"SystemAssigned",principalId:"different"}}],
  ["ingress security",{ingress:{...ingress,allowInsecure:true}}],
  ...[ ["CPU",{resources:{cpu:1}}], ["memory",{resources:{memory:"2Gi"}}],
    ["probe",{probes:[{type:"Readiness",httpGet:{path:"/changed"}}]}],
    ["command",{command:["different"]}], ["args",{args:["different"]}],
    ["mount",{volumeMounts:[{volumeName:"different",mountPath:"/data"}]}],
    ["environment value",{env:[{name:"LEGACY_PRIVATE_VALUE",value:"changed"}]}],
    ["secret reference",{env:[{name:"LEGACY_PRIVATE_VALUE",secretRef:"changed"}]}],
    ["unexpected image type",{imageType:"Artifact"}]
  ].map(([name,patch])=>[name,{template:{...template,containers:[{...template.containers[0],...patch as object}]}}] as [string,Record<string,unknown>]),
  ["volume",{template:{...template,volumes:[{name:"different",storageType:"EmptyDir"}]}}],
  ["non-null metrics",{template:{...template,customMetricsSettings:{exposed:true}}}],
  ["non-null ingress scheme",{ingress:{...ingress,targetPortHttpScheme:"https"}}],
  ["unknown template field",{template:{...template,unknownNewField:true}}],
  ["unknown ingress field",{ingress:{...ingress,unknownNewField:true}}]
 ];
 it.each(driftCases)("fails closed on %s drift before mutation",async(_name,patch)=>{
  const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>productionRead(args)?productionArm(patch):original(args));
  await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies())).rejects.toThrow();
  expect(mutations()).toHaveLength(0);
 });
 it.each([
  ["image default",{template:{...template,containers:[{...template.containers[0],imageType:"ContainerImage"}]}}],
  ["null metrics",{template:{...template,customMetricsSettings:null}}],
  ["null ingress scheme",{ingress:{...ingress,targetPortHttpScheme:null}}],
  ["all demonstrated defaults",{template:{...template,customMetricsSettings:null,containers:[{...template.containers[0],imageType:"ContainerImage"}]},ingress:{...ingress,targetPortHttpScheme:null}}]
 ])("accepts %s without changing the evidence",async(_name,patch)=>{
  const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>productionRead(args)?productionArm(patch as Record<string,unknown>):original(args));
  await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies())).resolves.toMatchObject({candidateCreated:true});
  expect(state.baseline).toEqual(before);expect(mutations()).toHaveLength(1);
 });
 it("sorts object keys recursively but preserves arrays and scalar values",()=>{
  expect(canonicalJson({b:{z:2,a:1},a:[{z:2,a:1},false,null,0,""]})).toBe(canonicalJson({a:[{a:1,z:2},false,null,0,""],b:{a:1,z:2}}));
  expect(canonicalJson([1,2])).not.toBe(canonicalJson([2,1]));
  expect(canonicalJson({value:"1"})).not.toBe(canonicalJson({value:1}));
 });
 it("accepts recursively reordered ARM and evidence keys",async()=>{
  const reverse=(v:unknown):unknown=>Array.isArray(v)?v.map(reverse):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reverse(x)])):v;
  const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>productionRead(args)?JSON.stringify(reverse(JSON.parse(productionArm()))):original(args));
  await expect(mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),{...dependencies(),readFile:async()=>JSON.stringify(reverse(state))})).resolves.toMatchObject({candidateCreated:true});
 });
 it("does not mutate the raw projection or remove unknown/non-null fields",()=>{
  const raw={template:{customMetricsSettings:{enabled:true},containers:[{imageType:"Artifact",unknown:true}]},ingress:{targetPortHttpScheme:"https",unknown:true}};
  expect(semanticProjection(raw)).toEqual(raw);expect(semanticProjection(raw)).not.toBe(raw);
 });
 it("pins only production baseline GET to the verified stable API",async()=>{
  await mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32"}),dependencies());
  const reads=az.mock.calls.map(c=>c[0]).filter(productionRead);
  expect(reads).toHaveLength(1);expect(BASELINE_API_VERSION).toBe("2025-07-01");
  expect(reads[0]).toEqual(["rest","--method","get","--url",`/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}/providers/Microsoft.App/containerApps/${MCP_TARGET}?api-version=2025-07-01`,"-o","json"]);
 });
 it.each([undefined,"legacy","future-v2"])("rejects incompatible evidence version %s before baseline read or writes",async version=>{
  state.fingerprintVersion=version as string;
  await expect(mcpRelease("candidate",input("candidate"),dependencies())).rejects.toThrow("unsupported_fingerprint_version");expect(az).not.toHaveBeenCalled();
 });
 it("rejects a mismatched baseline version",async()=>{
  state.baseline.fingerprintVersion="legacy";
  await expect(mcpRelease("candidate",input("candidate"),dependencies())).rejects.toThrow("unsupported_fingerprint_version");expect(az).not.toHaveBeenCalled();
 });
 it("new build declares the version and retains rollback revision/image without secrets",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>args[0]==="acr"?args.includes("digest")?"sha256:"+digest:args.includes("repository")?"false":"":original(args));
  await mcpRelease("build",input("build",{ownerBaselineConnected:true,baselineReadToolsVerified:true}),dependencies());
  const saved=JSON.parse(write.mock.calls[0][1]);
  expect(saved.fingerprintVersion).toBe(FINGERPRINT_VERSION);expect(saved.baseline.fingerprintVersion).toBe(FINGERPRINT_VERSION);
  expect(saved.baseline.revision).toBe(before.revision);expect(saved.baseline.image).toBe(oldImage);
  expect(JSON.stringify(saved)).not.toContain("DO-NOT-PERSIST-SECRET");
 });
});
describe("delivery input/provenance restrictions",()=>{
 it.each(["0.0.0.0/0","10.0.0.1/32","127.0.0.1/32","8.8.8.8/24","999.1.1.1/32","8.8.8.8/32;evil"])("rejects operator range %s",value=>expect(()=>operatorCidr(value)).toThrow());
 it("requires immutable correct-repository image and canonical candidate audience",()=>{
  expect(mcpImage(c,image)).toBe(image);expect(()=>mcpImage(c,image.replace("@sha256:",":"))).toThrow();
  const resource=candidateResource(c,image,"8.8.8.8/32");expect(resource.properties.configuration.activeRevisionsMode).toBe("Single");expect(resource.properties.template.containers[0].env).toContainEqual({name:"MCP_RESOURCE_URI",value:c.mcpResource});expect(resource.identity.type).toBe("SystemAssigned,UserAssigned");
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

describe("sanitized MCP candidate failure stages",()=>{
 async function diagnosticFailure(overrides:Record<string,unknown>={},extra:Record<string,unknown>={}) {
  try {await mcpRelease("candidate",input("candidate",{operatorCidr:"8.8.8.8/32",...extra}),{...dependencies(),...overrides});throw new Error("expected_failure");}
  catch(error){return releaseDiagnostic(error);}
 }
 it("reports baseline drift before any candidate operation",async()=>{
  state.baseline.configFingerprint="e".repeat(64);
  expect(await diagnosticFailure()).toEqual({mcpReleaseSucceeded:false,stage:"baseline",category:"baseline_changed"});expect(mutations()).toHaveLength(0);
 });
 it("reports invalid payload without a PUT",async()=>{
  expect(await diagnosticFailure({}, {operatorCidr:"10.0.0.1/32"})).toEqual({mcpReleaseSucceeded:false,stage:"candidate_payload",category:"invalid_payload"});expect(mutations()).toHaveLength(0);
 });
 it("reports overwrite conflict at the existence check",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>args[0]==="resource"?"1":original(args));
  expect(await diagnosticFailure()).toEqual({mcpReleaseSucceeded:false,stage:"candidate_existence_check",category:"resource_conflict"});expect(mutations()).toHaveLength(0);
 });
 it.each(["candidate_existence_check","candidate_arm_put","candidate_evidence"])("unknown %s failures cannot leak command/body/header/env canaries",async stage=>{
  const canary="SECRET-CANARY-token-cookie-password-OTP";
  const error=Object.assign(new Error(canary),{stderr:canary,stdout:canary,body:canary,headers:{Authorization:canary},category:canary,stage:canary});
  const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>{if((stage==="candidate_existence_check"&&args[0]==="resource")||(stage==="candidate_arm_put"&&args.includes("put")))throw error;return original(args);});
  const result=await diagnosticFailure(stage==="candidate_evidence"?{writeFile:async(path:string)=>{if(path.endsWith("mcp-release.json"))throw error;}}:{});
  expect(result).toEqual({mcpReleaseSucceeded:false,stage,category:"unknown"});expect(JSON.stringify(result)).not.toContain(canary);
 });
 it("retains sanitized Azure authorization category at ARM PUT",async()=>{
  const original=az.getMockImplementation()!;az.mockImplementation(async args=>{if(args.includes("put"))throw releaseFailure("authorization_failed");return original(args);});
  expect(await diagnosticFailure()).toEqual({mcpReleaseSucceeded:false,stage:"candidate_arm_put",category:"authorization_failed"});
 });
});


describe("bounded exact MCP cutover and recovery readiness",()=>{
 const flags={ownerBaselineConnected:true,baselineReadToolsVerified:true,emergencyPilotRollbackApproved:true};
 const cutoverRevision=MCP_TARGET+"--s3-"+sha.slice(0,12),recoveryRevision=MCP_TARGET+"--s3-recovery-"+sha.slice(0,12);
 function sequence(action:"cutover"|"rollback",states:Record<string,unknown>[],options:{ready?:string;latest?:string;sourceImage?:string;existingRecovery?:boolean;restoredEnv?:boolean;defaults?:boolean}={}){
  if(action==="rollback")state.cutoverStarted=true;
  let changed=false,time=0,index=0,selected:Record<string,unknown>={};
  const original=az.getMockImplementation()!,expected=action==="cutover"?cutoverRevision:recoveryRevision;
  az.mockImplementation(async args=>{
   if(args.includes("update")||args.includes("copy")){changed=true;return "";}
   const name=revisionRead(args);
   if(name===before.revision)return revisionArm(name,{template:{...template,containers:[{...template.containers[0],image:options.sourceImage??oldImage}]}});
   if(args.some(a=>a.endsWith(`/containerApps/${MCP_TARGET}/revisions?api-version=${BASELINE_API_VERSION}`)))return JSON.stringify({value:options.existingRecovery?[{name:recoveryRevision}]:[]});
   if(changed&&name===expected){selected=states[Math.min(index++,states.length-1)];return revisionArm(expected,selected);}
   if(productionRead(args)){
    if(!changed)return action==="rollback"?productionArm({image,revision:before.revision,latest:cutoverRevision}):productionArm();
    const healthy=selected.healthState!=="None";
    const patch={revision:options.ready??(healthy?expected:before.revision),latest:options.latest??expected,image:action==="cutover"?image:oldImage};
    const output=JSON.parse(productionArm(patch));
    if(options.restoredEnv===false)output.properties.template.containers[0].env=[{name:"WRONG",value:"SECRET-CANARY"}];
    if(options.defaults){output.properties.template.customMetricsSettings=null;output.properties.template.containers[0].imageType="ContainerImage";output.properties.configuration.ingress.targetPortHttpScheme=null;}
    return JSON.stringify(output);
   }
   return original(args);
  });
  const pause=vi.fn(async(ms:number)=>{time+=ms;});
  return {...dependencies(),pause,now:()=>time};
 }
 const activating={healthState:"None",runningState:"Activating"};
 it.each(["cutover","rollback"] as const)("%s waits through Activating and old latestReady",async action=>{
  const deps=sequence(action,[activating,activating,{}]);
  await expect(mcpRelease(action,input(action,flags),deps)).resolves.toMatchObject(action==="cutover"?{cutoverConfirmed:true}:{temporaryPrelaunchPilotRecovery:true});
  expect(deps.pause).toHaveBeenCalledTimes(2);expect(deps.pause.mock.calls.every(c=>c[0]===READINESS_INTERVAL_MS)).toBe(true);
  expect(JSON.stringify(write.mock.calls)).not.toContain("DO-NOT-PERSIST-SECRET");
 });
 it.each(["cutover","rollback"] as const)("%s terminal failure exposes only allowlisted category",async action=>{
  const deps=sequence(action,[{...activating,runningState:"Failed",raw:"SECRET-CANARY"}]);
  const error=await mcpRelease(action,input(action,flags),deps).catch((e:unknown)=>e);
  expect(releaseDiagnostic(error)).toEqual({mcpReleaseSucceeded:false,stage:`${action}_readiness`,category:`${action}_revision_failed`});
  expect(deps.pause).not.toHaveBeenCalled();expect(JSON.stringify(write.mock.calls)).not.toContain("cutoverConfirmed");
  expect(JSON.stringify(releaseDiagnostic(error))).not.toContain("SECRET-CANARY");
 });
 it.each(["cutover","rollback"] as const)("%s hard timeout retains only started evidence",async action=>{
  const deps=sequence(action,[activating]);
  const error=await mcpRelease(action,input(action,flags),deps).catch((e:unknown)=>e);
  expect(releaseDiagnostic(error)).toEqual({mcpReleaseSucceeded:false,stage:`${action}_readiness`,category:`${action}_readiness_timeout`});
  expect(deps.pause).toHaveBeenCalledTimes(READINESS_TIMEOUT_MS/READINESS_INTERVAL_MS);
  if(action==="cutover")expect(JSON.parse(write.mock.calls[0][1]).cutoverStarted).toBe(true);
  expect(write.mock.calls.some(c=>JSON.parse(c[1]).cutoverConfirmed||JSON.parse(c[1]).emergencyPilotRecovery)).toBe(false);
 });
 it("includes Azure read latency in the hard deadline",async()=>{
  const deps=sequence("cutover",[{}]);let time=0;
  deps.now=()=>{time+=READINESS_TIMEOUT_MS;return time;};
  const error=await mcpRelease("cutover",input("cutover",flags),deps).catch((e:unknown)=>e);
  expect(releaseDiagnostic(error).category).toBe("cutover_readiness_timeout");
 });
 it("times out an in-flight read without exposing its eventual response",async()=>{
  vi.useFakeTimers();try{
   const deps=sequence("cutover",[{}]);const original=az.getMockImplementation()!;
   az.mockImplementation(async args=>revisionRead(args)===cutoverRevision?new Promise<string>(()=>{}):original(args));
   const promise=mcpRelease("cutover",input("cutover",flags),deps).catch((e:unknown)=>e);
   await vi.advanceTimersByTimeAsync(READINESS_TIMEOUT_MS);
   expect(releaseDiagnostic(await promise).category).toBe("cutover_readiness_timeout");
  }finally{vi.useRealTimers();}
 });
 it("wrong expected-revision image fails immediately",async()=>{
  const deps=sequence("cutover",[{template:{...template,containers:[{image:oldImage}]}}]);
  await expect(mcpRelease("cutover",input("cutover",flags),deps)).rejects.toThrow("revision_image_mismatch");expect(deps.pause).not.toHaveBeenCalled();
 });
 it("a wrong revision returned for the exact GET fails closed",async()=>{
  const deps=sequence("cutover",[{}]);const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>revisionRead(args)===cutoverRevision?JSON.stringify({name:"unrelated",properties:{template}}):original(args));
  await expect(mcpRelease("cutover",input("cutover",flags),deps)).rejects.toThrow();
 });
 it.each([{ready:MCP_TARGET+"--unrelated"},{latest:MCP_TARGET+"--unrelated"}])("unrelated ready/latest revision never satisfies confirmation: %j",async options=>{
  const deps=sequence("cutover",[{}],options);await expect(mcpRelease("cutover",input("cutover",flags),deps)).rejects.toThrow("unexpected_runtime");
 });
 it("Healthy alone is insufficient while latestReady is old",async()=>{
  const deps=sequence("cutover",[{}],{ready:before.revision});
  const error=await mcpRelease("cutover",input("cutover",flags),deps).catch((e:unknown)=>e);expect(releaseDiagnostic(error).category).toBe("cutover_readiness_timeout");
 });
 it.each([{active:false},{runningState:"Unknown"},{provisioningState:"Unknown"}])("ambiguous active/runtime state cannot confirm: %j",async patch=>{
  const deps=sequence("cutover",[patch]);const error=await mcpRelease("cutover",input("cutover",flags),deps).catch((e:unknown)=>e);expect(releaseDiagnostic(error).category).toBe("cutover_readiness_timeout");
 });
 it("an explicitly pinned old traffic revision is not accepted",async()=>{
  const deps=sequence("cutover",[{}]);const original=az.getMockImplementation()!;let updated=false;
  az.mockImplementation(async args=>{if(args.includes("update"))updated=true;const response=await original(args);if(updated&&productionRead(args)){const app=JSON.parse(response);app.properties.configuration.ingress.traffic=[{revisionName:before.revision,weight:100}];return JSON.stringify(app);}return response;});
  await expect(mcpRelease("cutover",input("cutover",flags),deps)).rejects.toThrow();
 });
 it("retained historical image is verified before any copy",async()=>{
  const deps=sequence("rollback",[{}],{sourceImage:image});await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow("retained_revision_changed");expect(mutations()).toHaveLength(0);
 });
 it("missing historical revision fails before copying",async()=>{
  const deps=sequence("rollback",[{}]);const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>revisionRead(args)===before.revision?Promise.reject(new Error("SECRET-CANARY")):original(args));
  await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow();expect(mutations()).toHaveLength(0);
 });
 it("existing recovery suffix is never overwritten",async()=>{
  const deps=sequence("rollback",[{}],{existingRecovery:true});await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow("recovery_revision_already_exists");expect(mutations()).toHaveLength(0);
 });
 it.each([{value:[{}]},{value:[],nextLink:"another-page"}])("ambiguous recovery absence evidence prevents copying: %j",async payload=>{
  const deps=sequence("rollback",[{}]);const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>args.some(a=>a.endsWith(`/containerApps/${MCP_TARGET}/revisions?api-version=${BASELINE_API_VERSION}`))?JSON.stringify(payload):original(args));
  await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow("recovery_revision_already_exists");expect(mutations()).toHaveLength(0);
 });
 it("failed-startup rollback does not require the Slice 3 revision latestReady",async()=>{
  const deps=sequence("rollback",[activating,{}]);await expect(mcpRelease("rollback",input("rollback",flags),deps)).resolves.toMatchObject({temporaryPrelaunchPilotRecovery:true});
  expect(mutations()[0]).toContain(before.revision);expect(mutations()[0]).not.toContain("--image");
 });
 it("known canonical-semantic-v1 defaults and suffix change restore successfully",async()=>{
  const defaults={...template,revisionSuffix:"recovery",customMetricsSettings:null,containers:[{...template.containers[0],imageType:"ContainerImage"}]};
  const deps=sequence("rollback",[{template:defaults}],{defaults:true});
  await expect(mcpRelease("rollback",input("rollback",flags),deps)).resolves.toMatchObject({temporaryPrelaunchPilotRecovery:true});
  expect(revisionTemplateFingerprint(defaults)).toBe(revisionTemplateFingerprint(template));
 });
 it.each([
  {template:{...template,containers:[{...template.containers[0],env:[{name:"WRONG",value:"SECRET-CANARY"}]}]}},
  {template:{...template,containers:[{...template.containers[0],command:["different"]}]}},
  {template:{...template,unknown:true}}
 ])("material historical template difference fails: %j",async patch=>{
  const deps=sequence("rollback",[patch]);await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow("historical_configuration_not_restored");expect(write).not.toHaveBeenCalled();
 });
 it("an overlaid app environment fails even if recovery revision is correct",async()=>{
  const deps=sequence("rollback",[{}],{restoredEnv:false});await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow("historical_configuration_not_restored");
 });
 it("unrelated production state cannot authorize copying",async()=>{
  const deps=sequence("rollback",[{}]);const original=az.getMockImplementation()!;
  az.mockImplementation(async args=>productionRead(args)?productionArm({image,revision:MCP_TARGET+"--unrelated"}):original(args));
  await expect(mcpRelease("rollback",input("rollback",flags),deps)).rejects.toThrow("unexpected_runtime");expect(mutations()).toHaveLength(0);
 });
 it.each([false,undefined])("rollback still requires explicit emergency approval: %s",async approved=>{
  const deps=sequence("rollback",[{}]);await expect(mcpRelease("rollback",input("rollback",{emergencyPilotRollbackApproved:approved}),deps)).rejects.toThrow("temporary_prelaunch_rollback_approval_required");expect(mutations()).toHaveLength(0);
 });
});
