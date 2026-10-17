import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { breadcrumbPreflight, releaseMigrationContext, contextEnv, pollReceipt, migrationAttestation, receiptConfiguration, storeEnv, readBlob, receipt } from "./migration-breadcrumbs.mjs";
import { migrationJobArgs } from "./migration-features.mjs";
import { receiptUrl } from "../../dist/database/migrationReceiptStore.js";

// Shared by migration-only and ordinary preparation. One start, no automatic migration retry.
export async function executeMigration(call, c, built, plan, {checkpoint = async () => {}, write = writeFile,
  preflight = breadcrumbPreflight, retrieve = pollReceipt, sleep = ms => new Promise(r => setTimeout(r, ms)), env = process.env} = {}) {
  const migrationContext = releaseMigrationContext(built, plan, env), receiptStore = await receiptConfiguration();
  await preflight(call, c, receiptStore);
  await checkpoint({context:migrationContext}); // Persist UNPROVEN before the first mutation.
  let execution, migrationProof, result;
  await call(["containerapp", "job", "update", "-n", c.migrationJob, "-g", c.resourceGroup, "--image", built.image, "--command", "node", "--args", ...migrationJobArgs(plan), "--set-env-vars", contextEnv(migrationContext), storeEnv(receiptStore), "-o", "none"]);
  const job = JSON.parse(await call(["containerapp", "job", "show", "-n", c.migrationJob, "-g", c.resourceGroup, "--query", "properties.template.containers[].{image:image,command:command,args:args,context:env[?name=='CW_MIGRATION_CONTEXT'].value,store:env[?name=='CW_MIGRATION_RECEIPT_STORE'].value}", "-o", "json"]));
  if (!Array.isArray(job) || job.length !== 1 || job[0].image !== built.image || JSON.stringify(job[0].command) !== JSON.stringify(["node"]) || JSON.stringify(job[0].args) !== JSON.stringify(migrationJobArgs(plan))) throw new Error("migration_job_mismatch");
  if (JSON.stringify(job[0].context) !== JSON.stringify([contextEnv(migrationContext).split("=")[1]])) throw new Error("migration_job_context_mismatch");
  if (JSON.stringify(job[0].store) !== JSON.stringify([storeEnv(receiptStore).split("=")[1]])) throw new Error("migration_job_store_mismatch");
  execution = await call(["containerapp", "job", "start", "-n", c.migrationJob, "-g", c.resourceGroup, "--query", "name", "-o", "tsv"]);
  if (!/^[a-z0-9-]+$/.test(execution))
      throw new Error("invalid_execution");
  await checkpoint({context:migrationContext,execution});
  let migrated = false;
  for (let i = 0; i < 40; i++) {
      const status = await call(["containerapp", "job", "execution", "show", "-n", c.migrationJob, "-g", c.resourceGroup, "--job-execution-name", execution, "--query", "properties.status", "-o", "tsv"]);
      if (status === "Succeeded") {
          migrated = true;
          break;
      }
      if (status === "Failed")
          break;
      await sleep(3000);
  }
  const executionContainers = JSON.parse(await call(["containerapp", "job", "execution", "show", "-n", c.migrationJob, "-g", c.resourceGroup, "--job-execution-name", execution, "--query", "properties.template.containers[].{image:image,command:command,args:args,context:env[?name=='CW_MIGRATION_CONTEXT'].value,store:env[?name=='CW_MIGRATION_RECEIPT_STORE'].value}", "-o", "json"]));
  if (JSON.stringify(executionContainers) !== JSON.stringify(job)) throw new Error("migration_execution_mismatch");
  // Detailed receipts have a separate 30-day lifetime; active provenance retains an attestation only.
  let evidence, observed = [];
  try {
      evidence = await retrieve(call, migrationContext, execution, plan, {store:receiptStore, observe: events => { observed = events; }});
      if (!migrated) throw new Error("migration_not_succeeded");
      migrationProof = migrationAttestation(evidence);
      result = evidence.result;
  } finally {
      await write(".delivery/migration-breadcrumb.json", JSON.stringify({version:"migration-breadcrumb-v1", context:migrationContext, execution, azureExecutionSucceeded:migrated, ...(evidence ? {evidence} : {completion:"unproven", events:observed})}) + "\n");
  }
  return {version:"release-migration-v1", status:"proven", context:migrationContext, execution,
    plan, attestation:migrationProof, result};
}

// Re-read exact immutable receipts; never search logs or list objects. Compact provenance is
// retained separately; detailed receipt payloads stay in the 30-day breadcrumb artifact only.
export async function verifyMigration(call, c, built, plan, record, {read = readBlob, now = Date.now} = {}) {
  const fail = () => { throw new Error("migration_evidence_unproven"); };
  if (!record || record.version !== "release-migration-v1" || record.status !== "proven" ||
      record.context?.sha !== built.sha || record.context?.image !== built.image ||
      record.context?.selection !== plan.selection || record.context?.manifestFingerprint !== plan.manifestFingerprint ||
      !isDeepStrictEqual(record.plan, plan) || !/^[a-z0-9-]+$/.test(record.execution || "")) fail();
  const store = await receiptConfiguration();
  const job = JSON.parse(await call(["containerapp","job","execution","show","-n",c.migrationJob,"-g",c.resourceGroup,
    "--job-execution-name",record.execution,"--query","{status:properties.status,containers:properties.template.containers[].{image:image,command:command,args:args,context:env[?name=='CW_MIGRATION_CONTEXT'].value,store:env[?name=='CW_MIGRATION_RECEIPT_STORE'].value}}","-o","json"]));
  const expected = [{image:built.image, command:["node"], args:migrationJobArgs(plan),
    context:[contextEnv(record.context).split("=")[1]],store:[storeEnv(store).split("=")[1]]}];
  if (job.status !== "Succeeded" || !isDeepStrictEqual(job.containers, expected)) fail();
  const events = [];
  for (const phase of ["start","completion"]) {
    const event = await read(call, receiptUrl(store, record.context, record.execution, phase));
    if (!event || event.event !== (phase === "start" ? "migration.start" : "migration.success")) fail();
    events.push(event);
  }
  const evidence = receipt(events, record.context, record.execution, plan, now(), () => {}, {reuse:true});
  if (!evidence || !isDeepStrictEqual(migrationAttestation(evidence), record.attestation) ||
      !isDeepStrictEqual(evidence.result, record.result)) fail();
  return record;
}
