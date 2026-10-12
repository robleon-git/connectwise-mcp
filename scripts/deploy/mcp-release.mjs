// Explicit MCP-affecting delivery only. The control-only release/impact guard is unchanged.
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir,readFile,writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuration,execute,assertSubscription } from "./common.mjs";
import { mcpAz, releaseFailure, markReleaseStage, releaseDiagnostic } from "./mcp-release-diagnostics.mjs";
import { controlCondition, requireControlTraffic, readControlTraffic } from "./control-condition.mjs";
import { release as controlRelease } from "./release.mjs";
import { requireManualMcpWorkflow } from "./mcp-evidence-download.mjs";
import { smoke } from "./smoke.mjs";
export const FINGERPRINT_VERSION = "canonical-semantic-v1";
export const BASELINE_API_VERSION = "2025-07-01";
export const MCP_TARGET = "connectwise-mcp-pilot";
export const MCP_CANDIDATE = "connectwise-mcp-slice3-candidate";
export const ISSUER = "https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au";
export const JWKS = "https://api.descope.com/P3KF3ouEKxhaIJBilPItOXL8i76g/.well-known/jwks.json";
export const ACCEPTANCE_KEYS = ["ownerLinked","customerOneConnected","secondCustomerSetupDenied","unknownPrincipalZeroCalls","invalidEntitlementZeroCalls","malformedReferencesNoCalls","crossAccountDenied","concurrencyIsolated","exactReadTools","schemasUnchanged","noPilotFallback","sanitizedEvidence"];
export const READINESS_TIMEOUT_MS = 600000;
export const READINESS_INTERVAL_MS = 5000;
// Revision suffix is the deliberately new identity, not historical runtime configuration.
export function revisionTemplateFingerprint(template) {
  const projected=semanticProjection({template}).template;
  delete projected.revisionSuffix;
  return fingerprint(projected);
}
const shaPattern=/^[a-f0-9]{40}$/;
export function mcpImage(c,image) {if(typeof image!=="string"||!new RegExp(`^${c.registry}\\.azurecr\\.io/connectwise-mcp@sha256:[a-f0-9]{64}$`).test(image))throw releaseFailure("invalid_payload","invalid_mcp_image");return image;}
function controlImage(c,image) {if(typeof image!=="string"||!new RegExp(`^${c.registry}\\.azurecr\\.io/connectwise-control-api@sha256:[a-f0-9]{64}$`).test(image))throw new Error("invalid_control_image");return image;}
export function acceptance(value) {
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==ACCEPTANCE_KEYS.length||ACCEPTANCE_KEYS.some(k=>value[k]!==true))throw new Error("candidate_acceptance_incomplete");
  return Object.fromEntries(ACCEPTANCE_KEYS.map(k=>[k,true]));
}
export function operatorCidr(cidr) {
  const match=typeof cidr==="string"&&cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/32$/);
  if(!match||match.slice(1).some(n=>Number(n)>255)||[0,10,127].includes(Number(match[1]))||Number(match[1])>=224||
    (Number(match[1])===172&&Number(match[2])>=16&&Number(match[2])<=31)||(Number(match[1])===192&&Number(match[2])===168)||
    (Number(match[1])===169&&Number(match[2])===254))throw releaseFailure("invalid_payload","operator_public_ipv4_required");
  return cidr;
}
export function mcpEnvironment(c) {return [
  ["NODE_ENV","production"],["MCP_TRANSPORT","http"],["MCP_HTTP_HOST","0.0.0.0"],["MCP_HTTP_PORT","8080"],["AUTH_MODE","env"],
  ["MCP_ALLOW_UNAUTHENTICATED_LOCAL","false"],["DESCOPE_MCP_ISSUER",ISSUER],["DESCOPE_MCP_JWKS_URI",JWKS],["MCP_RESOURCE_URI",c.mcpResource],["MCP_REQUIRED_SCOPE","connectwise.read"],
  ["CW_DB_HOST",`${c.databaseServer}.postgres.database.azure.com`],["CW_DB_NAME","connectwise"],["CW_DB_USER","cw_mcp"],["CW_DB_PASSWORD_SECRET","cw-mcp-db-password"],["CW_KEY_VAULT_URI","https://cw-mcp-kv.vault.azure.net"]
].map(([name,value])=>({name,value}));}
export function candidateResource(c,image,cidr) {
  mcpImage(c,image);operatorCidr(cidr);
  const shared=`/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}/providers`;
  const pull=`${shared}/Microsoft.ManagedIdentity/userAssignedIdentities/connectwise-mcp-pull-id`;
  return {location:"eastus",identity:{type:"SystemAssigned,UserAssigned",userAssignedIdentities:{[pull]:{}}},properties:{managedEnvironmentId:`${shared}/Microsoft.App/managedEnvironments/monotorr-prod-aca-env`,
    configuration:{activeRevisionsMode:"Single",registries:[{server:`${c.registry}.azurecr.io`,identity:pull}],ingress:{external:true,allowInsecure:false,targetPort:8080,transport:"auto",
      ipSecurityRestrictions:[{name:"operator-only",action:"Allow",ipAddressRange:cidr}],traffic:[{latestRevision:true,weight:100}]}},
    template:{containers:[{name:MCP_CANDIDATE,image,env:mcpEnvironment(c),resources:{cpu:0.5,memory:"1Gi"}}],scale:{minReplicas:1,maxReplicas:1}}}};
}
// Sort only object keys; array order and scalar values remain significant.
export function canonicalJson(value) {
  const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])) : value;
  return JSON.stringify(sort(value));
}
// Only defaults proven equivalent across the stable/preview ARM representations.
export function semanticProjection(raw) {
  const result = structuredClone(raw);
  for (const container of result.template?.containers ?? []) {
    if (container.imageType === "ContainerImage") delete container.imageType;
  }
  if (result.template?.customMetricsSettings === null) delete result.template.customMetricsSettings;
  if (result.ingress?.targetPortHttpScheme === null) delete result.ingress.targetPortHttpScheme;
  return result;
}
const fingerprint = value => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function configurationFingerprint(raw) {
  const value = semanticProjection(raw);
  return fingerprint({template:value.template,ingress:value.ingress});
}
// Baseline includes a configuration fingerprint, never configuration values or secrets.
export function preservedConfiguration(raw) {
  raw = semanticProjection(raw);
  return fingerprint({ingress:raw.ingress,identity:raw.identity,scale:raw.template?.scale,
    containers:raw.template?.containers?.map(container=>({name:container.name,resources:container.resources,command:container.command,args:container.args,probes:container.probes,volumeMounts:container.volumeMounts})),volumes:raw.template?.volumes});
}
export function baseline(c,raw) {
  if(raw.fingerprintVersion!==FINGERPRINT_VERSION)throw new Error("unsupported_fingerprint_version");
  if(raw.mode!=="Single"||!/^connectwise-mcp-pilot--[a-z0-9-]+$/.test(raw.revision||"")||!Array.isArray(raw.traffic)||raw.traffic.length!==1||raw.traffic[0].weight!==100||
    !(raw.traffic[0].latestRevision===true||raw.traffic[0].revisionName===raw.revision)||typeof raw.probeCount!=="number"||typeof raw.configFingerprint!=="string"||!/^[a-f0-9]{64}$/.test(raw.preservedFingerprint||""))throw new Error("ambiguous_mcp_baseline");
  mcpImage(c,raw.image);return {fingerprintVersion:FINGERPRINT_VERSION,revision:raw.revision,image:raw.image,mode:"Single",traffic:raw.traffic,probeCount:raw.probeCount,configFingerprint:raw.configFingerprint,preservedFingerprint:raw.preservedFingerprint};
}
export async function mcpRelease(action,inputs={},dependencies={}) {
  let stage="release";
  try {
  const call=dependencies.az||mcpAz,run=dependencies.execute||execute,read=dependencies.readFile||readFile,write=dependencies.writeFile||writeFile;
  const c=await (dependencies.configuration||configuration)();
  const head=(await run("git",["rev-parse","HEAD"])).stdout.trim();
  if(!shaPattern.test(head)||inputs.reviewedSha!==head)throw new Error("reviewed_source_mismatch");
  if((await run("git",["status","--porcelain"])).stdout.trim())throw new Error("dirty_release_source");
  if(!["build","prepare-control","promote-control","candidate","accept-candidate","cutover","rollback","cleanup"].includes(action))throw new Error("invalid_mcp_release_action");
  const confirm=()=>{if(inputs.approval!==`${action}:${head}`)throw new Error("explicit_owner_action_approval_required");};confirm();
  await (dependencies.assertSubscription||assertSubscription)(c);
  const target=["-n",MCP_TARGET,"-g",c.sharedResourceGroup];
  const resourceId=`/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}/providers/Microsoft.App/containerApps/${MCP_TARGET}`;
  const readArm=async(path="")=>JSON.parse(await call(["rest","--method","get","--url",`${resourceId}${path}?api-version=${BASELINE_API_VERSION}`,"-o","json"]));
  const revision=async name=>{
    if(!/^connectwise-mcp-pilot--[a-z0-9-]+$/.test(name))throw releaseFailure("invalid_payload");
    const selected=await readArm(`/revisions/${name}`);
    if(selected.name!==name||!selected.properties?.template?.containers?.length)throw releaseFailure("invalid_payload");
    return selected;
  };
  const fromArm=arm=>{
    const properties=arm.properties;
    const raw={fingerprintVersion:FINGERPRINT_VERSION,revision:properties?.latestReadyRevisionName,
      mode:properties?.configuration?.activeRevisionsMode,traffic:properties?.configuration?.ingress?.traffic,
      image:properties?.template?.containers?.[0]?.image,probeCount:properties?.template?.containers?.[0]?.probes?.length ?? 0,
      template:properties?.template,ingress:properties?.configuration?.ingress,identity:arm.identity};
    // Raw ARM template is kept in memory only; even legacy configured values are never serialized.
    raw.configFingerprint=configurationFingerprint(raw);
    raw.preservedFingerprint=preservedConfiguration(raw);
    return baseline(c,raw);
  };
  const current=async()=>fromArm(await readArm());
  const waitReady=async(expected,image,retainedTemplate)=>{
    const now=dependencies.now||(()=>performance.now());
    const pause=dependencies.pause||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    const deadline=now()+READINESS_TIMEOUT_MS;
    const timeout=()=>releaseFailure(`${action}_readiness_timeout`);
    // Includes read latency; an Azure read cannot extend the hard deadline.
    const bounded=async operation=>{
      const remaining=deadline-now();if(remaining<=0)throw timeout();
      let timer;
      try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(timeout()),remaining);})]);}
      finally{clearTimeout(timer);}
    };
    while(now()<deadline){
      const selected=await bounded(()=>revision(expected));const p=selected.properties;
      if(p.template.containers.length!==1||p.template.containers[0].image!==image)throw releaseFailure("invalid_payload","revision_image_mismatch");
      if([p.provisioningState,p.runningState,p.healthState].some(v=>["Failed","ProvisioningFailed","Degraded"].includes(v)))throw releaseFailure(`${action}_revision_failed`);
      const arm=await bounded(()=>readArm());const live=arm.properties;const actual=fromArm(arm);
      if(live.latestRevisionName!==expected||actual.image!==image||actual.mode!=="Single"||actual.preservedFingerprint!==state.baseline.preservedFingerprint||
         ![state.baseline.revision,`${MCP_TARGET}--s3-${head.slice(0,12)}`,expected].includes(live.latestReadyRevisionName))throw releaseFailure("baseline_changed","unexpected_runtime_stop_for_operator_review");
      if(retainedTemplate&&(revisionTemplateFingerprint(p.template)!==revisionTemplateFingerprint(retainedTemplate)||
         canonicalJson(live.template.containers.map(c=>c.env))!==canonicalJson(retainedTemplate.containers.map(c=>c.env))))throw releaseFailure("baseline_changed","historical_configuration_not_restored");
      if(p.active===true&&p.healthState==="Healthy"&&["Provisioned","Succeeded"].includes(p.provisioningState)&&
         ["Running","RunningAtMaxScale","RunningAtMinScale"].includes(p.runningState)&&live.latestReadyRevisionName===expected){
        if(now()>=deadline)throw timeout();
        if(!(actual.traffic[0].latestRevision===true||actual.traffic[0].revisionName===expected))throw releaseFailure("baseline_changed","effective_revision_mismatch");
        return actual;
      }
      await bounded(()=>pause(READINESS_INTERVAL_MS));
    }
    throw timeout();
  };
  const save=async state=>{await (dependencies.mkdir||mkdir)(".delivery",{recursive:true});await write(".delivery/mcp-release.json",JSON.stringify(state)+"\n");};
  const load=async()=>{
    const state=JSON.parse(await read(".delivery/mcp-release.json","utf8"));
    if(state.fingerprintVersion!==FINGERPRINT_VERSION||state.baseline?.fingerprintVersion!==FINGERPRINT_VERSION)throw new Error("unsupported_fingerprint_version");
    if(state.sha!==head)throw new Error("artifact_source_mismatch");mcpImage(c,state.mcpImage);controlImage(c,state.controlImage);
    if(!state.baseline||!/^connectwise-mcp-pilot--[a-z0-9-]+$/.test(state.baseline.revision||"")||state.baseline.mode!=="Single"||!/^[a-f0-9]{64}$/.test(state.baseline.configFingerprint||""))throw new Error("invalid_rollback_evidence");
    mcpImage(c,state.baseline.image);return state;
  };
  const unchanged=async state=>{if(canonicalJson(await current())!==canonicalJson(baseline(c,state.baseline)))throw releaseFailure("baseline_changed","production_baseline_changed");};
  const publicSmoke=()=> (dependencies.smoke||smoke)("https://api.monotorr.com","mcp");
  if(action==="build") {
    if(inputs.ownerBaselineConnected!==true||inputs.baselineReadToolsVerified!==true)throw new Error("fresh_owner_and_inventory_baseline_required");
    stage="baseline";
    const before=await current();await publicSmoke();stage="release";
    const build=async(repository,dockerfile)=>{
      const exists=await call(["acr","repository","list","-n",c.registry,"--query",`contains(@, '${repository}')`,"-o","tsv"]);
      if(exists==="true"&&await call(["acr","repository","show-tags","-n",c.registry,"--repository",repository,"--query",`contains(@, '${head}')`,"-o","tsv"])==="true")throw new Error("immutable_build_already_exists");
      const tag=`${c.registry}.azurecr.io/${repository}:${head}`;
      await run("docker",["build","--platform","linux/amd64","-f",dockerfile,"--build-arg",`COMMIT_SHA=${head}`,"-t",tag,"."],{timeout:600000,maxBuffer:8*1024*1024});
      await call(["acr","login","-n",c.registry]);await run("docker",["push",tag],{timeout:600000,maxBuffer:8*1024*1024});
      return `${c.registry}.azurecr.io/${repository}@${await call(["acr","manifest","show-metadata","--registry",c.registry,"--name",`${repository}:${head}`,"--query","digest","-o","tsv"])}`;
    };
    const mcp=mcpImage(c,await build("connectwise-mcp","Dockerfile")),control=controlImage(c,await build("connectwise-control-api","Dockerfile.control-plane"));
    await save({fingerprintVersion:FINGERPRINT_VERSION,sha:head,mcpImage:mcp,controlImage:control,baseline:before,baselineReadToolsVerified:true,ownerBaselineConnected:true});
    return {built:true};
  }
  stage="baseline";
  const state=await load();
  if(action!=="rollback"&&action!=="cleanup")await unchanged(state);
  stage="release";
  if(action==="prepare-control") {
    if(!/^[A-Za-z0-9._-]{1,256}$/.test(inputs.linkingClientId||""))throw new Error("fixed_linking_client_required");
    // Invalidate prior control promotion before preparation; preserve MCP acceptance and rollback evidence.
    state.controlPromoted=false;await save(state);
    // Compute the Slice 3 condition inside preparation before any live mutation.
    await write(".delivery/built-image.json",JSON.stringify({sha:head,image:state.controlImage})+"\n");
    await (dependencies.controlRelease||controlRelease)("prepare-slice3");
    const control=JSON.parse(await read(".delivery/control-release.json","utf8"));
    if(control.sha!==head||control.image!==state.controlImage)throw new Error("control_artifact_mismatch");
    const suffix=`s3-link-${head.slice(0,12)}`;
    await call(["containerapp","update","-n",c.controlApi,"-g",c.resourceGroup,"--image",state.controlImage,"--revision-suffix",suffix,"--set-env-vars","CW_MCP_LINKING_ENABLED=true",`CW_MCP_LINK_CLIENT_ID=${inputs.linkingClientId}`,`DESCOPE_MCP_ISSUER=${ISSUER}`,`DESCOPE_MCP_JWKS_URI=${JWKS}`,`MCP_RESOURCE_URI=${c.mcpResource}`,"MCP_REQUIRED_SCOPE=connectwise.read","-o","none"]);
    const preparedRevision=`${c.controlApi}--${suffix}`;
    let prepared;
    for(let i=0;i<30;i++){
      prepared=JSON.parse(await call(["containerapp","revision","show","-n",c.controlApi,"-g",c.resourceGroup,"--revision",preparedRevision,"--query","{health:properties.healthState,image:properties.template.containers[0].image,active:properties.active,fqdn:properties.fqdn}","-o","json"]));
      if(prepared.image!==state.controlImage)throw new Error("control_candidate_image_mismatch");
      if(prepared.health==="Healthy"&&prepared.active===true)break;
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    if(prepared?.health!=="Healthy"||prepared.active!==true||!prepared.fqdn)throw new Error("control_candidate_not_ready");
    await (dependencies.smoke||smoke)(`https://${prepared.fqdn}`,"control-api");
    state.control={...control,revision:preparedRevision};state.controlPromoted=false;
    await save(state);return {controlPrepared:true};
  }
  if(action==="promote-control") {
    if(!state.control||state.control.sha!==head||state.control.image!==state.controlImage||!/^connectwise-control-api--s3-link-[a-f0-9]{12}$/.test(state.control.revision||""))throw new Error("control_candidate_missing");
    const condition=await controlCondition(state.control.previousSha,head,dependencies);
    if(condition.kind==="control-only"&&canonicalJson(condition)!==canonicalJson(state.control.condition))throw new Error("control_only_evidence_mismatch");
    if(state.control.condition&&canonicalJson(condition)!==canonicalJson(state.control.condition))throw new Error("control_condition_changed");
    const selected=JSON.parse(await call(["containerapp","revision","show","-n",c.controlApi,"-g",c.resourceGroup,"--revision",state.control.revision,"--query","{health:properties.healthState,image:properties.template.containers[0].image,active:properties.active,fqdn:properties.fqdn}","-o","json"]));
    if(selected.health!=="Healthy"||selected.image!==state.controlImage||selected.active!==true||!selected.fqdn)throw new Error("control_candidate_not_ready");
    const target=["-n",c.controlApi,"-g",c.resourceGroup];
    const previous=JSON.parse(await call(["containerapp","revision","show",...target,"--revision",state.control.previousRevision,"--query","{health:properties.healthState,image:properties.template.containers[0].image,active:properties.active}","-o","json"]));
    if(previous.health!=="Healthy"||previous.image!==state.control.previousImage||previous.active!==true)throw new Error("control_rollback_not_ready");
    const runtime=JSON.parse(await call(["containerapp","show","-n",c.controlApi,"-g",c.resourceGroup,"--query","{mode:properties.configuration.activeRevisionsMode,fqdn:properties.configuration.ingress.fqdn,traffic:properties.configuration.ingress.traffic}","-o","json"]));
    if(runtime.mode!=="Multiple")throw new Error("control_revision_mode_required");
    requireControlTraffic(runtime.traffic,state.control.previousRevision);
    const fqdn=runtime.fqdn;
    await (dependencies.smoke||smoke)(`https://${fqdn}`,"control-api");
    await (dependencies.smoke||smoke)(`https://${selected.fqdn}`,"control-api");
    // Pin the old revision before moving a label that might currently carry traffic.
    await call(["containerapp","ingress","traffic","set",...target,"--revision-weight",`${state.control.previousRevision}=100`,"-o","none"]);
    await readControlTraffic(call,target,state.control.previousRevision);
    await call(["containerapp","revision","label","add",...target,"--revision",state.control.revision,"--label","candidate","--yes","-o","none"]);
    await (dependencies.smoke||smoke)(`https://${c.controlApi}---candidate.${fqdn.split(".").slice(1).join(".")}`,"control-api");
    try {
      await call(["containerapp","ingress","traffic","set",...target,"--revision-weight",`${state.control.revision}=100`,"-o","none"]);
      await readControlTraffic(call,target,state.control.revision);
      await (dependencies.smoke||smoke)(`https://${fqdn}`,"control-api");await publicSmoke();
      state.controlPromoted=true;await save(state);
    } catch(error) {
      state.controlPromoted=false;
      // Restore only the preverified rollback revision, including on an ambiguous timeout.
      await call(["containerapp","ingress","traffic","set",...target,"--revision-weight",`${state.control.previousRevision}=100`,"-o","none"]);
      await readControlTraffic(call,target,state.control.previousRevision);
      await (dependencies.smoke||smoke)(`https://${fqdn}`,"control-api");
      throw error;
    }
    return {controlPromoted:true};
  }
  if(action==="candidate") {
    stage="candidate_payload";
    const resource=candidateResource(c,state.mcpImage,inputs.operatorCidr);
    // PUT exists only after an explicit absence check. Never overwrite another candidate.
    stage="candidate_existence_check";
    const exists=await call(["resource","list","-g",c.resourceGroup,"--resource-type","Microsoft.App/containerApps","--query",`length([?name=='${MCP_CANDIDATE}'])`,"-o","tsv"]);
    if(exists!=="0")throw releaseFailure("resource_conflict","candidate_already_exists");
    stage="candidate_payload";
    await write(".delivery/mcp-candidate.json",JSON.stringify(resource)+"\n");
    // ARM PUT avoids CLI convenience logic that may attempt implicit ACR role assignments.
    const resourceId=`/subscriptions/${c.subscriptionId}/resourceGroups/${c.resourceGroup}/providers/Microsoft.App/containerApps/${MCP_CANDIDATE}`;
    stage="candidate_arm_put";
    await call(["rest","--method","put","--url",`${resourceId}?api-version=2024-03-01`,"--body","@.delivery/mcp-candidate.json","-o","none"]);
    stage="candidate_evidence";
    state.candidate={name:MCP_CANDIDATE,operatorCidr:inputs.operatorCidr};await save(state);return {candidateCreated:true,permissionsRequireSeparateOperatorApproval:true};
  }
  const candidateReady=async()=>{
    if(state.candidate?.name!==MCP_CANDIDATE)throw new Error("isolated_candidate_missing");operatorCidr(state.candidate.operatorCidr);
    const selected=JSON.parse(await call(["containerapp","show","-n",MCP_CANDIDATE,"-g",c.resourceGroup,"--query","{mode:properties.configuration.activeRevisionsMode,image:properties.template.containers[0].image,health:properties.provisioningState,revision:properties.latestReadyRevisionName,latest:properties.latestRevisionName,env:properties.template.containers[0].env,restrictions:properties.configuration.ingress.ipSecurityRestrictions,domains:properties.configuration.ingress.customDomains}","-o","json"]));
    if(selected.mode!=="Single"||selected.image!==state.mcpImage||selected.health!=="Succeeded"||!selected.revision||selected.latest!==selected.revision||JSON.stringify(selected.env)!==JSON.stringify(mcpEnvironment(c))||selected.domains?.length||selected.restrictions?.length!==1||selected.restrictions[0].ipAddressRange!==state.candidate.operatorCidr||selected.restrictions[0].action!=="Allow")throw new Error("isolated_candidate_not_ready");
    const health=await call(["containerapp","revision","show","-n",MCP_CANDIDATE,"-g",c.resourceGroup,"--revision",selected.revision,"--query","properties.healthState","-o","tsv"]);
    if(health!=="Healthy")throw new Error("isolated_candidate_not_ready");
    return selected.revision;
  };
  if(action==="accept-candidate") {
    const passed=acceptance(inputs.acceptance);const revision=await candidateReady();
    state.acceptance={...passed,revision,image:state.mcpImage};await save(state);return {candidateAcceptanceRecorded:true};
  }
  if(action==="cutover") {
    if(inputs.ownerBaselineConnected!==true||inputs.baselineReadToolsVerified!==true||inputs.emergencyPilotRollbackApproved!==true)throw new Error("fresh_cutover_owner_approval_required");
    if(!state.controlPromoted||!state.acceptance||state.acceptance.image!==state.mcpImage)throw new Error("candidate_acceptance_missing");
    acceptance(Object.fromEntries(ACCEPTANCE_KEYS.map(k=>[k,state.acceptance[k]])));
    if(await candidateReady()!==state.acceptance.revision)throw new Error("accepted_candidate_changed");
    await publicSmoke();state.cutoverStarted=true;await save(state); // Retain rollback baseline BEFORE mutation.
    await call(["containerapp","update",...target,"--image",state.mcpImage,"--revision-suffix",`s3-${head.slice(0,12)}`,"--set-env-vars",...mcpEnvironment(c).map(e=>`${e.name}=${e.value}`),"--remove-env-vars","CW_CONFIG_SOURCE","CW_MANAGE_URL","CW_MANAGE_COMPANY_ID","CW_MANAGE_CLIENT_ID","CW_MANAGE_PUBLIC_KEY","CW_MANAGE_PRIVATE_KEY","MCP_APPROVED_USER_ID","MCP_APPROVED_USER_CLAIM","-o","none"]);
    stage="cutover_readiness";
    await waitReady(`${MCP_TARGET}--s3-${head.slice(0,12)}`,state.mcpImage);
    await publicSmoke();state.cutoverConfirmed=true;await save(state);return {cutoverConfirmed:true,ownerLiveAcceptanceStillRequired:true};
  }
  if(action==="rollback") {
    if(inputs.emergencyPilotRollbackApproved!==true||!state.cutoverStarted)throw new Error("temporary_prelaunch_rollback_approval_required");
    const expected=`${MCP_TARGET}--s3-${head.slice(0,12)}`,recovery=`${MCP_TARGET}--s3-recovery-${head.slice(0,12)}`;
    // latestReady may still be the historical source after a failed startup.
    const arm=await readArm(),actual=fromArm(arm);
    if(arm.properties.latestRevisionName!==expected||actual.image!==state.mcpImage||actual.preservedFingerprint!==state.baseline.preservedFingerprint||
       ![state.baseline.revision,expected].includes(arm.properties.latestReadyRevisionName))throw releaseFailure("baseline_changed","unexpected_runtime_stop_for_operator_review");
    const source=await revision(state.baseline.revision);
    if(source.properties.template.containers.length!==1||source.properties.template.containers[0].image!==state.baseline.image)throw releaseFailure("baseline_changed","retained_revision_changed");
    const revisions=await readArm("/revisions");
    if(!Array.isArray(revisions.value)||revisions.nextLink||revisions.value.some(r=>!r||!/^connectwise-mcp-pilot--[a-z0-9-]+$/.test(r.name||"")||r.name===recovery))throw releaseFailure("resource_conflict","recovery_revision_already_exists");
    // No --image: the installed CLI otherwise overlays the current containers.
    await call(["containerapp","revision","copy",...target,"--from-revision",state.baseline.revision,"--revision-suffix",`s3-recovery-${head.slice(0,12)}`,"-o","none"]);
    stage="rollback_readiness";
    await waitReady(recovery,state.baseline.image,source.properties.template);
    await publicSmoke();state.emergencyPilotRecovery=true;await save(state);return {temporaryPrelaunchPilotRecovery:true};
  }
  if(action==="cleanup") {
    // Operator first removes exact candidate identity role assignments, then explicitly invokes this action.
    const principal=await call(["containerapp","show","-n",MCP_CANDIDATE,"-g",c.resourceGroup,"--query","identity.principalId","-o","tsv"]);
    if(!/^[a-f0-9-]{36}$/.test(principal))throw new Error("candidate_identity_unknown");
    const base=`/subscriptions/${c.subscriptionId}/resourceGroups/`;
    const scopes=[`${base}${c.resourceGroup}/providers/Microsoft.KeyVault/vaults/monotorr-cw-creds-kv`,`${base}${c.sharedResourceGroup}/providers/Microsoft.KeyVault/vaults/cw-mcp-kv/secrets/cw-mcp-db-password`];
    const roles=[];
    for(const scope of scopes) roles.push(...JSON.parse(await call(["role","assignment","list","--scope",scope,"--include-inherited","--fill-principal-name","false","--query",`[?principalId=='${principal}'].id`,"-o","json"])));
    if(roles.length)throw new Error("candidate_role_cleanup_required");
    await call(["containerapp","delete","-n",MCP_CANDIDATE,"-g",c.resourceGroup,"--yes","-o","none"]);return {candidateRemoved:true};
  }
  }catch(error){throw markReleaseStage(error,stage);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if(process.argv.length!==3)throw new Error();
    requireManualMcpWorkflow(process.env);
    const inputs={reviewedSha:process.env.CW_REVIEWED_SHA,approval:process.env.CW_OWNER_ACTION_APPROVAL,operatorCidr:process.env.CW_OPERATOR_CIDR,linkingClientId:process.env.CW_MCP_LINK_CLIENT_ID,
      ownerBaselineConnected:process.env.CW_OWNER_BASELINE_CONNECTED==="true",baselineReadToolsVerified:process.env.CW_BASELINE_READ_TOOLS_VERIFIED==="true",emergencyPilotRollbackApproved:process.env.CW_EMERGENCY_PILOT_ROLLBACK_APPROVED==="true",
      acceptance:process.env.CW_CANDIDATE_ACCEPTANCE?JSON.parse(process.env.CW_CANDIDATE_ACCEPTANCE):undefined};
    console.log(JSON.stringify(await mcpRelease(process.argv[2],inputs)));
  }catch(error){console.error(JSON.stringify(releaseDiagnostic(error)));process.exitCode=1;}
}
