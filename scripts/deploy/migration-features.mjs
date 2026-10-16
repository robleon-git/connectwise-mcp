// Release configuration selects schema; the migration job never independently interprets feature flags.
import { execute } from "./common.mjs";
import { readMigrationContract } from "./control-condition.mjs";
import { smoke } from "./smoke.mjs";
import { createHash } from "node:crypto";
import { billingConfig } from "../../dist/billing/config.js";
import { MIGRATIONS, requiredMigrations } from "../../dist/database/migrationManifest.js";
import { loadMigrations, migrationFeatures } from "../../dist/database/migrationRunner.js";
export function controlRequirements(env) {
  return billingConfig(env) ? "core,billing" : "core";
}
export async function migrationPlan(selection) {
  const features = migrationFeatures(selection);
  const all = await loadMigrations(MIGRATIONS, new URL("../../database/migrations/", import.meta.url));
  const requiredIds = requiredMigrations(features).map(item => item.id);
  return { selection, requirements: ["core", ...features], requiredIds,
    optionalIds: all.filter(item => !requiredIds.includes(item.id)).map(item => item.id),
    manifestFingerprint: createHash("sha256").update(JSON.stringify(all)).digest("hex") };
}
export async function readControlRequirements(call, c, revision) {
  const target = ["-n", c.controlApi, "-g", c.resourceGroup];
  const args = revision ? ["containerapp", "revision", "show", ...target, "--revision", revision] : ["containerapp", "show", ...target];
  // Retrieve only the two nonsecret feature-selection fields, never application secrets.
  const containers = JSON.parse(await call([...args, "--query", "properties.template.containers[].{env:env[?name=='NODE_ENV'||name=='CW_BILLING_ENABLED']}", "-o", "json"]));
  if (!Array.isArray(containers) || containers.length !== 1 || !Array.isArray(containers[0].env)) throw new Error("control_features_unproven");
  const env = { NODE_ENV: "production" }; // The reviewed control image also defaults to production.
  for (const entry of containers[0].env) {
    if (!entry || !["NODE_ENV", "CW_BILLING_ENABLED"].includes(entry.name) || entry.secretRef !== undefined || typeof entry.value !== "string" ||
      containers[0].env.filter(item => item.name === entry.name).length !== 1) throw new Error("control_features_unproven");
    env[entry.name] = entry.value;
  }
  // This delivery path is production-only. Existing billingConfig rejects production opt-in.
  if (env.NODE_ENV !== "production") throw new Error("control_features_unproven");
  return controlRequirements(env);
}
export async function verifyControlRequirements(call, c, plan, revision) {
  const actual = await migrationPlan(await readControlRequirements(call, c, revision));
  if (JSON.stringify(actual) !== JSON.stringify(plan)) throw new Error("control_features_changed");
}
export function migrationJobArgs(plan) {
  migrationFeatures(plan?.selection);
  return ["dist/database/cli.js", plan.selection];
}
export function migrationCompletion(text, plan) {
  // Logs are parsed privately. Only the allowlisted result below may enter release evidence.
  const events = text.split("\n").flatMap(line => { try { const envelope = JSON.parse(line); const event = typeof envelope.Log === "string" ? JSON.parse(envelope.Log) : envelope; return event.event === "migration.completed" ? [event] : []; } catch { return []; } });
  if (events.length !== 1) throw new Error("migration_result_unproven");
  const result = events[0], ids = [...plan.requiredIds, ...plan.optionalIds];
  for (const key of ["appliedIds", "deferredIds", "installedOptionalIds"]) {
    if (!Array.isArray(result[key]) || result[key].some(id => !ids.includes(id)) || new Set(result[key]).size !== result[key].length) throw new Error("migration_result_unproven");
  }
  if (JSON.stringify(result.requirements) !== JSON.stringify(plan.requirements) || result.applied !== result.appliedIds.length ||
    result.appliedIds.some(id => !plan.requiredIds.includes(id)) || result.deferredIds.some(id => !plan.optionalIds.includes(id)) ||
    result.installedOptionalIds.some(id => !MIGRATIONS.some(item => item.id === id && item.requirement !== "core")) ||
    MIGRATIONS.filter(item => item.requirement !== "core").some(item => Number(result.deferredIds.includes(item.id)) + Number(result.installedOptionalIds.includes(item.id)) !== 1) ||
    plan.optionalIds.some(id => Number(result.deferredIds.includes(id)) + Number(result.installedOptionalIds.includes(id)) !== 1)) throw new Error("migration_result_unproven");
  return { requirements: result.requirements, applied: result.applied, appliedIds: result.appliedIds,
    deferredIds: result.deferredIds, installedOptionalIds: result.installedOptionalIds };
}

// Active release provenance, separate from expiring operational migration receipts.
// The eligible rollback set is exactly the serving pair captured by preparation;
// historical revisions are never implicitly promoted into that set.
export function schemaCompatibilityProof(target, serving, rollback = serving) {
  const fail = () => { throw new Error("release_schema_incompatible"); };
  if (!target?.plan || !Array.isArray(target.contract?.execution) || !target.sha || !target.controlImage || !target.mcpImage) fail();
  const required = target.contract.execution.filter(item => target.plan.requiredIds.includes(item.id));
  const requiredIds = target.contract.execution.filter(item => item.requirement === "core" || target.plan.selection === "core,billing").map(item => item.id);
  if (JSON.stringify(requiredIds) !== JSON.stringify(target.plan.requiredIds)) fail();
  for (const pair of [serving, rollback]) {
    if (!pair?.mcp || !pair?.control) fail();
    for (const artifact of [pair.mcp, pair.control]) {
      if (!artifact.revision || !artifact.image || !artifact.sha || !Array.isArray(artifact.contract?.execution) || !Array.isArray(artifact.contract?.catalog)) fail();
      const supported = new Map([...artifact.contract.execution, ...artifact.contract.catalog].map(item => [item.id, item.checksum]));
      if (required.some(item => supported.get(item.id) !== item.checksum)) fail();
      // Existing executable SQL may not disappear or change, including disabled features.
      if (artifact.contract.execution.some(item => !target.contract.execution.some(next => next.id === item.id && next.checksum === item.checksum))) fail();
      if (target.contract.execution.some(item => supported.has(item.id) && supported.get(item.id) !== item.checksum)) fail();
    }
  }
  // One retained control readiness check can attest installed-history compatibility
  // for both rollback artifacts only when they accept the exact same history set.
  const support = artifact => JSON.stringify([...artifact.contract.execution, ...artifact.contract.catalog].map(({id, checksum}) => ({id, checksum})).sort((a,b) => a.id.localeCompare(b.id)));
  if (support(rollback.mcp) !== support(rollback.control)) fail();
  const compact = artifact => ({revision:artifact.revision, image:artifact.image, sha:artifact.sha,
    contractFingerprint:hashContract(artifact.contract)});
  return {version:"schema-compatibility-v1", target:{sha:target.sha, controlImage:target.controlImage, mcpImage:target.mcpImage,
    contractFingerprint:hashContract(target.contract), plan:target.plan},
    serving:{mcp:compact(serving.mcp), control:compact(serving.control)},
    rollback:{eligible:true, mcp:compact(rollback.mcp), control:compact(rollback.control)}, compatible:true};
}
function hashContract(contract) { return createHash("sha256").update(JSON.stringify(contract)).digest("hex"); }
async function registryContract(call, c, image, run) {
  if (typeof image !== "string" || !image.startsWith(`${c.registry}.azurecr.io/`) || !/^connectwise-(?:mcp|control-api)@sha256:[a-f0-9]{64}$/.test(image.split("/")[1] || "")) throw new Error("artifact_provenance_unproven");
  const metadata = JSON.parse(await call(["acr", "manifest", "show-metadata", "--registry", c.registry, "--name", image.split("/")[1], "--query", "{digest:digest,tags:tags}", "-o", "json"]));
  const tags = Array.isArray(metadata?.tags) ? metadata.tags.filter(tag => /^[a-f0-9]{40}$/.test(tag)) : [];
  if (metadata?.digest !== image.split("@")[1] || tags.length !== 1) throw new Error("artifact_provenance_unproven");
  return {image, sha:tags[0], contract:await readMigrationContract(tags[0], run)};
}
function appTarget(c, kind) { return ["-n", kind === "mcp" ? "connectwise-mcp-pilot" : c.controlApi, "-g", kind === "mcp" ? c.sharedResourceGroup : c.resourceGroup]; }
async function servingRevision(call, c, kind) {
  const app = JSON.parse(await call(["containerapp", "show", ...appTarget(c, kind), "--query", "{mode:properties.configuration.activeRevisionsMode,revision:properties.latestReadyRevisionName,traffic:properties.configuration.ingress.traffic}", "-o", "json"]));
  const traffic = app?.traffic;
  if (app?.mode !== (kind === "mcp" ? "Single" : "Multiple") || !Array.isArray(traffic) || traffic.some(t => !Number.isInteger(t.weight) || t.weight < 0 || t.weight > 100) || traffic.reduce((sum,t) => sum+t.weight,0) !== 100 || traffic.filter(t => t.weight > 0).length !== 1) throw new Error("serving_artifact_unproven");
  const selected = traffic.find(t => t.weight === 100);
  const revision = selected.latestRevision === true && kind === "mcp" ? app.revision : selected.latestRevision !== true ? selected.revisionName : undefined;
  if (typeof revision !== "string" || selected.latestRevision === true && selected.revisionName !== undefined && selected.revisionName !== revision) throw new Error("serving_artifact_unproven");
  return revision;
}
async function revisionArtifact(call, c, kind, revision, run, requireHealthy = false) {
  const name = kind === "mcp" ? "connectwise-mcp-pilot" : c.controlApi;
  if (!new RegExp(`^${name}--[a-z0-9-]+$`).test(revision || "")) throw new Error("retained_artifact_unproven");
  const selected = JSON.parse(await call(["containerapp", "revision", "show", ...appTarget(c, kind), "--revision", revision, "--query", "{image:properties.template.containers[0].image,health:properties.healthState,fqdn:properties.fqdn}", "-o", "json"]));
  if (!selected || requireHealthy && selected.health !== "Healthy") throw new Error("retained_artifact_unproven");
  const artifact = await registryContract(call, c, selected.image, run);
  if (!artifact.image.includes(`/connectwise-${kind === "mcp" ? "mcp" : "control-api"}@`)) throw new Error("artifact_provenance_unproven");
  return {...artifact, revision, fqdn:selected.fqdn};
}
async function targetContract(call, c, built, plan, run) {
  const control = await registryContract(call, c, built.image, run);
  const digest = await call(["acr", "manifest", "show-metadata", "--registry", c.registry, "--name", `connectwise-mcp:${built.sha}`, "--query", "digest", "-o", "tsv"]);
  const mcp = await registryContract(call, c, `${c.registry}.azurecr.io/connectwise-mcp@${digest}`, run);
  if (control.sha !== built.sha || mcp.sha !== built.sha || !control.image.includes("/connectwise-control-api@")) throw new Error("artifact_provenance_unproven");
  return {sha:built.sha, controlImage:built.image, mcpImage:mcp.image, contract:control.contract, plan};
}
export async function prepareSchemaCompatibility(call, c, built, plan, run = execute) {
  const serving = {};
  for (const kind of ["mcp", "control"]) serving[kind] = await revisionArtifact(call, c, kind, await servingRevision(call, c, kind), run, true);
  const target = await targetContract(call, c, built, plan, run);
  return schemaCompatibilityProof(target, serving);
}
export async function verifySchemaCompatibility(call, c, manifest, phase, run = execute, check = smoke) {
  const proof = manifest?.schemaCompatibility;
  if (!proof || proof.version !== "schema-compatibility-v1" || !["promote", "cutover", "rollback"].includes(phase)) throw new Error("schema_compatibility_unproven");
  const plan = await migrationPlan(manifest.schemaPlan?.selection);
  if (JSON.stringify(plan) !== JSON.stringify(manifest.schemaPlan)) throw new Error("schema_compatibility_unproven");
  const target = await targetContract(call, c, manifest, plan, run);
  const serving = {}, rollback = {};
  for (const kind of ["mcp", "control"]) {
    serving[kind] = await revisionArtifact(call, c, kind, proof.serving?.[kind]?.revision, run);
    rollback[kind] = await revisionArtifact(call, c, kind, proof.rollback?.[kind]?.revision, run);
    const current = await revisionArtifact(call, c, kind, await servingRevision(call, c, kind), run, phase !== "rollback");
    const expected = phase === "cutover" && kind === "control" ? manifest.revision : proof.serving[kind].revision;
    const targetImage = kind === "mcp" ? target.mcpImage : target.controlImage;
    const targetRevision = kind === "mcp" ? `connectwise-mcp-pilot--s3-${manifest.sha.slice(0,12)}` : manifest.revision;
    if (!(current.revision === expected && current.image === proof.serving[kind].image ||
      current.revision === targetRevision && current.image === targetImage && (phase === "rollback" || phase === "cutover" && kind === "control") ||
      phase === "rollback" && kind === "mcp" && current.revision === `connectwise-mcp-pilot--s3-recovery-${manifest.sha.slice(0,12)}` && current.image === proof.rollback.mcp.image)) throw new Error("serving_artifact_changed");
  }
  if (JSON.stringify(schemaCompatibilityProof(target, serving, rollback)) !== JSON.stringify(proof) ||
    proof.rollback.control.revision !== manifest.previousRevision || proof.rollback.control.image !== manifest.previousImage) throw new Error("schema_compatibility_unproven");
  if (phase === "rollback") {
    // An old release proof cannot authorize an old runtime after a later schema
    // change: check the exact retained, immutable control artifact against today's
    // ledger. Its history support must match the retained MCP artifact (above).
    if (!rollback.control.fqdn) throw new Error("rollback_schema_unproven");
    await check(`https://${rollback.control.fqdn}`, "control-api");
  }
  return proof;
}
