import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { validateMigrationContext, BREADCRUMB_VERSION } from "../../dist/database/migrationBreadcrumb.js";
import { receiptStore, receiptUrl } from "../../dist/database/migrationReceiptStore.js";
import { migrationCompletion } from "./migration-features.mjs";
export async function receiptConfiguration() {
  return receiptStore(JSON.parse(await readFile(new URL("../../deployment/azure/migration-receipts.json", import.meta.url), "utf8")));
}
export function storeEnv(store) { return `CW_MIGRATION_RECEIPT_STORE=${Buffer.from(JSON.stringify(receiptStore(store))).toString("base64url")}`; }
export function releaseMigrationContext(built, plan, env = process.env) {
  return validateMigrationContext({ repository: env.GITHUB_REPOSITORY, run: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    sha: built.sha, image: built.image, request: randomUUID(), selection: plan.selection,
    manifestFingerprint: plan.manifestFingerprint, requestedAt: new Date().toISOString() });
}
export function contextEnv(context) { return `CW_MIGRATION_CONTEXT=${Buffer.from(JSON.stringify(context)).toString("base64url")}`; }

export async function readBlob(call, url, timeout = 30000, request = fetch) {
  const deadline = Date.now() + timeout;
  try {
    const token = await call(["account","get-access-token","--resource","https://storage.azure.com/","--query","accessToken","-o","tsv"], {timeout});
    if (!token || Date.now() >= deadline) throw new Error();
    const response = await request(url, {method:"GET",redirect:"error",signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())),headers:{
      Authorization:`Bearer ${token}`,"x-ms-version":"2023-11-03","x-ms-date":new Date().toUTCString()}});
    if (response.status === 404 && response.headers.get("x-ms-error-code") === "BlobNotFound") { await response.body?.cancel(); return undefined; }
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error(); }
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength;
        if (size > 65536) throw new Error(); chunks.push(value); }
    } finally { await reader.cancel(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new Error("migration_receipt_read_failed"); }
}
export async function breadcrumbPreflight(call, c, store, read = readBlob) {
  receiptStore(store);
  const resource = `https://management.azure.com/subscriptions/${c.subscriptionId}/resourceGroups/${c.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${store.account}`;
  const get = async path => JSON.parse(await call(["rest","--method","get","--url",`${resource}${path}?api-version=2023-05-01`,"-o","json"]));
  const account = await get(""), service = await get("/blobServices/default"), container = await get(`/blobServices/default/containers/${store.container}`), lifecycle = await get("/managementPolicies/default");
  if (account.kind !== "StorageV2" || account.properties?.allowBlobPublicAccess !== false || account.properties?.allowSharedKeyAccess !== false || account.properties?.supportsHttpsTrafficOnly !== true ||
      account.properties?.minimumTlsVersion !== "TLS1_2" || ![undefined,"None"].includes(container.properties?.publicAccess)) throw new Error("migration_store_security_unproven");
  const p = service.properties;
  if (!p || p.isVersioningEnabled === true || p.deleteRetentionPolicy?.enabled === true || p.containerDeleteRetentionPolicy?.enabled === true || p.restorePolicy?.enabled === true ||
      container.properties?.immutableStorageWithVersioning?.enabled === true || container.properties?.hasImmutabilityPolicy === true || container.properties?.hasLegalHold === true) throw new Error("migration_store_retention_unproven");
  const rules = lifecycle.properties?.policy?.rules;
  if (!Array.isArray(rules) || rules.length !== 1 || rules[0].enabled !== true || rules[0].type !== "Lifecycle" ||
      !isDeepStrictEqual(rules[0].definition?.filters, {blobTypes:["blockBlob"],prefixMatch:[`${store.container}/v1/`]}) ||
      !isDeepStrictEqual(rules[0].definition?.actions, {baseBlob:{delete:{daysAfterModificationGreaterThan:30}}})) throw new Error("migration_store_lifecycle_unproven");
  const job = JSON.parse(await call(["containerapp", "job", "show", "-n", c.migrationJob, "-g", c.resourceGroup,
    "--query", "properties.configuration.{retry:replicaRetryLimit,parallelism:manualTriggerConfig.parallelism,completions:manualTriggerConfig.replicaCompletionCount}", "-o", "json"]));
  if (job.retry !== 0 || job.parallelism !== 1 || job.completions !== 1) throw new Error("migration_execution_policy_unproven");
  await read(call, `https://${store.account}.blob.core.windows.net/${store.container}/v1/access-probe.json`);
}
export function receipt(eventsInput, context, execution, plan, now = Date.now(), observe = () => {}) {
  validateMigrationContext(context);
  const requested = Date.parse(context.requestedAt);
  if (now - requested > 30 * 86400_000) throw new Error("migration_receipt_expired");
  if (now - requested > 60 * 60_000 || requested > now + 60_000) throw new Error("migration_receipt_stale");
  const events = new Map();
  for (const e of eventsInput) {
    if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("migration_receipt_invalid");
    const phase = e.event?.replace("migration.", "");
    const fields = ["version","event","context","execution","timestamp", ...(phase === "success" ? ["schemaVerified","transactionCommitted","result"] : phase === "failure" ? ["schemaVerified","transactionCommitted","outcome","result"] : [])];
    const timestamp = Date.parse(e.timestamp);
    if (Object.keys(e).sort().join() !== fields.sort().join() || e.version !== BREADCRUMB_VERSION || !["start","success","failure"].includes(phase) ||
        !isDeepStrictEqual(e.context, context) || e.execution !== execution  ||
        !Number.isFinite(timestamp) || timestamp < requested - 60_000 || timestamp > now + 60_000) throw new Error("migration_receipt_mismatch");
    if (events.has(phase) && JSON.stringify(events.get(phase)) !== JSON.stringify(e)) throw new Error("migration_receipt_conflict");
    events.set(phase, e);
  }
  const failed = events.get("failure");
  if (failed && (failed.schemaVerified !== false || failed.outcome !== "unproven" || failed.transactionCommitted !== false || JSON.stringify(failed.result) !== JSON.stringify({appliedIds:null,deferredIds:null,installedOptionalIds:null}))) throw new Error("migration_receipt_invalid");
  if (failed && events.has("success")) throw new Error("migration_receipt_conflict");
  // Capture only fully validated allowlisted events; never save arbitrary query rows.
  if (!events.has("success")) observe([...events.values()]);
  if (failed) throw new Error("migration_reported_failure");
  const start = events.get("start"), end = events.get("success");
  if (!start || !end) return undefined;
  if (end.schemaVerified !== true || end.transactionCommitted !== true || Date.parse(start.timestamp) > Date.parse(end.timestamp)) throw new Error("migration_receipt_incomplete");
  const result = migrationCompletion(JSON.stringify({event:"migration.completed", ...end.result}), plan);
  // Only the allowlisted result is durable operational evidence. Unknown result keys are forbidden.
  if (Object.keys(end.result).sort().join() !== Object.keys(result).sort().join()) throw new Error("migration_receipt_invalid");
  observe([start, end]);
  return { version: BREADCRUMB_VERSION, context, execution, events: [start, end], result };
}
export async function pollReceipt(call, context, execution, plan, {store, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), timeout = 600000, observe = () => {}, read = readBlob} = {}) {
  validateMigrationContext(context); receiptStore(store);
  const deadline = now() + Math.min(timeout, 600000), seen = new Map();
  while (now() < deadline) {
    const events = [];
    for (const phase of ["start","completion"]) {
      if (now() >= deadline) break;
      const e = await read(call, receiptUrl(store,context,execution,phase), Math.max(1,Math.min(30000,deadline-now())));
      if (e !== undefined) {
        if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("migration_receipt_invalid");
        if ((phase === "start" && e.event !== "migration.start") || (phase === "completion" && !["migration.success","migration.failure"].includes(e.event))) throw new Error("migration_receipt_mismatch");
        if (seen.has(phase) && seen.get(phase) !== JSON.stringify(e)) throw new Error("migration_receipt_conflict");
        seen.set(phase,JSON.stringify(e)); events.push(e);
      }
    }
    const result = receipt(events, context, execution, plan, now(), observe);
    if (result) return result;
    await sleep(Math.min(15000,Math.max(0,deadline-now())));
  }
  throw new Error("migration_receipt_timeout"); // Never start another execution.
}
export function migrationAttestation(evidence) {
  return { version: evidence.version, receiptHash: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    sourceSha: evidence.context.sha, image: evidence.context.image, manifestFingerprint: evidence.context.manifestFingerprint,
    selection: evidence.context.selection, schemaVerified: true, azureExecutionSucceeded: true };
}
