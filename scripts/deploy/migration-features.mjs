// Release configuration selects schema; the migration job never independently interprets feature flags.
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
