import { expect } from "vitest";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { MIGRATIONS, migrationReadiness, type Migration } from "../../database/migrationManifest.js";
import { migrate, loadMigrations } from "../../database/migrationRunner.js";
export const ORIGINAL_SHA = "217e1d39b88e4a80ac63a743a351b47ab91c0ebb";
export const RELEASE_A_SHA = "1d13310c600c35e3c42a5d04b21927b6d7422c68";
export const RELEASE_B_SHA = "0509a15842ca31c0bff23ad8bfb60aab881da955";
// Frozen reviewed modules, checksum verified below; shallow CI needs no historical Git objects.
export const ORIGINAL_SOURCE = `export const MIGRATIONS = Object.freeze([
  { id: "0001_delivery_foundation", file: "0001_delivery_foundation.sql", checksum: "628acc7d80cd8134a6bb25c8adfa1b0a58b99c12c94acfc6377aaf94790544f1", requirement: "core" },
  { id: "0002_customer_foundation", file: "0002_customer_foundation.sql", checksum: "6e2682435970f69e090e5d4dd52e01eea33d10a649db3302f93ac6b46b070651", requirement: "core" },
  { id: "0003_connectwise_connections", file: "0003_connectwise_connections.sql", checksum: "6c8ecf4ae43946aa16bfe6de8937a8f5edf7b368c4a7ca081392fda4fad31e29", requirement: "core" },
  { id: "0004_mcp_identity_linkage", file: "0004_mcp_identity_linkage.sql", checksum: "cc4336854dafdc575fd5631d0fa07e62937202dfce52a2f4b9fb0de7d44f9c07", requirement: "core" },
  { id: "0005_web_paid_entitlement", file: "0005_web_paid_entitlement.sql", checksum: "35f4a74eb6f061365cc7d4a8392648e00ea2cc0b7704c8b0dbcfafe7d2eadb5a", requirement: "core" },
  { id: "0006_test_billing_foundation", file: "0006_test_billing_foundation.sql", checksum: "27b128d14c18f48668489ec6ce463a1b64dc0c946632abcde76c7e3481900ecc", requirement: "billing" },
  { id: "0007_test_billing_checkout", file: "0007_test_billing_checkout.sql", checksum: "cf319314cc19a8daf7782bf23c7166160d7f7aa50eb0a60c86f58d32a8006e83", requirement: "billing" }
] as const);

export type MigrationRequirement = "core" | "billing";
export interface Migration {
  readonly id: string;
  readonly file: string;
  readonly checksum: string;
  readonly requirement: MigrationRequirement;
}
export interface MigrationHistoryReader {
  query(sql: string): Promise<{ rows: unknown }>;
}
/** Validate the complete manifest even when a feature is disabled. */
export function validateMigrationManifest(manifest: readonly Migration[]): void {
  if (!Array.isArray(manifest) || !manifest.length) throw new Error("invalid_migration_manifest");
  let previous = "";
  for (const item of manifest) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[0-9]{4}_[a-z_]+$/.test(item.id) ||
      item.id <= previous || item.file !== item.id + ".sql" || typeof item.checksum !== "string" || !/^[a-f0-9]{64}$/.test(item.checksum) ||
      !["core", "billing"].includes(item.requirement)) throw new Error("invalid_migration_manifest");
    previous = item.id;
  }
}
/** No feature flag parsing here: the control caller supplies features from its validated configuration. */
export function requiredMigrations(features: readonly "billing"[] = [], manifest: readonly Migration[] = MIGRATIONS): readonly Migration[] {
  validateMigrationManifest(manifest);
  if (!Array.isArray(features) || features.some(feature => feature !== "billing") || new Set(features).size !== features.length)
    throw new Error("invalid_migration_features");
  return manifest.filter(item => item.requirement === "core" || features.includes(item.requirement));
}
/** All installed history is validated, including optional installed migrations. Missing rows are checked separately. */
export function validateMigrationHistory(history: unknown, manifest: readonly Migration[] = MIGRATIONS): Set<string> {
  validateMigrationManifest(manifest);
  if (!Array.isArray(history)) throw new Error("migration_history_mismatch");
  const known = new Map(manifest.map(item => [item.id, item.checksum]));
  const installed = new Set<string>();
  for (const row of history) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.checksum !== "string" ||
      installed.has(row.id) || !known.has(row.id) || known.get(row.id) !== row.checksum) throw new Error("migration_history_mismatch");
    installed.add(row.id);
  }
  return installed;
}
export function migrationHistoryReady(history: unknown, features: readonly "billing"[] = [], manifest: readonly Migration[] = MIGRATIONS): boolean {
  try {
    const required = requiredMigrations(features, manifest), installed = validateMigrationHistory(history, manifest);
    return required.every(item => installed.has(item.id));
  } catch { return false; }
}
/** Read-only schema verification, shared by control readiness and the MCP pre-listen startup gate. */
export async function migrationReadiness(db: MigrationHistoryReader, features: readonly "billing"[] = []): Promise<boolean> {
  try {
    requiredMigrations(features); // Reject invalid feature/manifest evidence before querying.
    const result = await db.query("SELECT id, checksum FROM public.schema_migrations ORDER BY id");
    return migrationHistoryReady(result.rows, features);
  } catch { return false; }
}
`;
export const RELEASE_A_SOURCE = `export const MIGRATIONS = Object.freeze([
  { id: "0001_delivery_foundation", file: "0001_delivery_foundation.sql", checksum: "628acc7d80cd8134a6bb25c8adfa1b0a58b99c12c94acfc6377aaf94790544f1", requirement: "core" },
  { id: "0002_customer_foundation", file: "0002_customer_foundation.sql", checksum: "6e2682435970f69e090e5d4dd52e01eea33d10a649db3302f93ac6b46b070651", requirement: "core" },
  { id: "0003_connectwise_connections", file: "0003_connectwise_connections.sql", checksum: "6c8ecf4ae43946aa16bfe6de8937a8f5edf7b368c4a7ca081392fda4fad31e29", requirement: "core" },
  { id: "0004_mcp_identity_linkage", file: "0004_mcp_identity_linkage.sql", checksum: "cc4336854dafdc575fd5631d0fa07e62937202dfce52a2f4b9fb0de7d44f9c07", requirement: "core" },
  { id: "0005_web_paid_entitlement", file: "0005_web_paid_entitlement.sql", checksum: "35f4a74eb6f061365cc7d4a8392648e00ea2cc0b7704c8b0dbcfafe7d2eadb5a", requirement: "core" },
  { id: "0006_test_billing_foundation", file: "0006_test_billing_foundation.sql", checksum: "27b128d14c18f48668489ec6ce463a1b64dc0c946632abcde76c7e3481900ecc", requirement: "billing" },
  { id: "0007_test_billing_checkout", file: "0007_test_billing_checkout.sql", checksum: "cf319314cc19a8daf7782bf23c7166160d7f7aa50eb0a60c86f58d32a8006e83", requirement: "billing" }
] as const);

/** Reviewed runtime tolerance only. These entries are never executable or required. */
export const FORWARD_COMPATIBILITY = Object.freeze([
  { id: "0008_account_name_edit", checksum: "db9c40c882343deb5eec9d26b06355665807e22ba7075ada0cf66efaf6977729" }
] as const);
export interface CompatibleMigration {
  readonly id: string;
  readonly checksum: string;
}
export function validateCompatibilityCatalog(catalog: readonly CompatibleMigration[], manifest: readonly Migration[]): void {
  validateMigrationManifest(manifest);
  if (!Array.isArray(catalog)) throw new Error("invalid_migration_catalog");
  const highest = Math.max(...manifest.map(item => Number(item.id.slice(0, 4))));
  let previous = highest;
  for (const item of catalog) {
    if (!item || typeof item !== "object" || Object.keys(item).sort().join(",") !== "checksum,id" ||
      typeof item.id !== "string" || !/^[0-9]{4}_[a-z_]+$/.test(item.id) || Number(item.id.slice(0, 4)) <= previous ||
      typeof item.checksum !== "string" || !/^[a-f0-9]{64}$/.test(item.checksum)) throw new Error("invalid_migration_catalog");
    previous = Number(item.id.slice(0, 4));
  }
}
export type MigrationRequirement = "core" | "billing";
export interface Migration {
  readonly id: string;
  readonly file: string;
  readonly checksum: string;
  readonly requirement: MigrationRequirement;
}
export interface MigrationHistoryReader {
  query(sql: string): Promise<{ rows: unknown }>;
}
/** Validate the complete manifest even when a feature is disabled. */
export function validateMigrationManifest(manifest: readonly Migration[]): void {
  if (!Array.isArray(manifest) || !manifest.length) throw new Error("invalid_migration_manifest");
  let previous = "";
  for (const item of manifest) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[0-9]{4}_[a-z_]+$/.test(item.id) ||
      item.id <= previous || item.file !== item.id + ".sql" || typeof item.checksum !== "string" || !/^[a-f0-9]{64}$/.test(item.checksum) ||
      !["core", "billing"].includes(item.requirement)) throw new Error("invalid_migration_manifest");
    previous = item.id;
  }
}
/** No feature flag parsing here: the control caller supplies features from its validated configuration. */
export function requiredMigrations(features: readonly "billing"[] = [], manifest: readonly Migration[] = MIGRATIONS): readonly Migration[] {
  validateMigrationManifest(manifest);
  if (!Array.isArray(features) || features.some(feature => feature !== "billing") || new Set(features).size !== features.length)
    throw new Error("invalid_migration_features");
  return manifest.filter(item => item.requirement === "core" || features.includes(item.requirement));
}
/** All installed history is validated, including optional installed migrations. Missing rows are checked separately. */
export function validateMigrationHistory(history: unknown, manifest: readonly Migration[] = MIGRATIONS): Set<string> {
  validateMigrationManifest(manifest);
  if (!Array.isArray(history)) throw new Error("migration_history_mismatch");
  const known = new Map(manifest.map(item => [item.id, item.checksum]));
  const installed = new Set<string>();
  for (const row of history) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.checksum !== "string" ||
      installed.has(row.id) || !known.has(row.id) || known.get(row.id) !== row.checksum) throw new Error("migration_history_mismatch");
    installed.add(row.id);
  }
  return installed;
}
export function validateRuntimeMigrationHistory(history: unknown, manifest: readonly Migration[] = MIGRATIONS,
  catalog: readonly CompatibleMigration[] = FORWARD_COMPATIBILITY): Set<string> {
  validateCompatibilityCatalog(catalog, manifest);
  // Reuse strict row/duplicate/checksum validation over the explicitly approved union.
  const compatible = catalog.map(item => ({ ...item, file: item.id + ".sql", requirement: "core" as const }));
  return validateMigrationHistory(history, [...manifest, ...compatible]);
}
export function migrationHistoryReady(history: unknown, features: readonly "billing"[] = [], manifest: readonly Migration[] = MIGRATIONS,
  catalog: readonly CompatibleMigration[] = FORWARD_COMPATIBILITY): boolean {
  try {
    const required = requiredMigrations(features, manifest), installed = validateRuntimeMigrationHistory(history, manifest, catalog);
    return required.every(item => installed.has(item.id));
  } catch { return false; }
}
/** Read-only schema verification, shared by control readiness and the MCP pre-listen startup gate. */
export async function migrationReadiness(db: MigrationHistoryReader, features: readonly "billing"[] = []): Promise<boolean> {
  try {
    requiredMigrations(features); // Reject invalid feature/manifest/catalog evidence before querying.
    validateCompatibilityCatalog(FORWARD_COMPATIBILITY, MIGRATIONS);
    const result = await db.query("SELECT id, checksum FROM public.schema_migrations ORDER BY id");
    return migrationHistoryReady(result.rows, features);
  } catch { return false; }
}
`;
export const RELEASE_B_SOURCE = ORIGINAL_SOURCE.replace("\n] as const);", ",\n" + "  { id: \"0008_account_name_edit\", file: \"0008_account_name_edit.sql\", checksum: \"db9c40c882343deb5eec9d26b06355665807e22ba7075ada0cf66efaf6977729\", requirement: \"core\" }" + "\n] as const);");
export const HISTORICAL_SOURCE_CHECKSUMS = {
  original: "6ec79e7270b842eb859b372e99ee4bc1560e689bae27b91e07c57972bfdd07e2",
  releaseA: "25ed2de01d73a20a0d97eaf59fbaa62f29cb736c6e81a622fd24eda4714c51ff",
  releaseB: "21e3bded3c8dbefc21968ae65cced5d043630f2323fcdd05a1e4a4a52002d848"
};
export const FUTURE_SQL = "-- Account display metadata only. No authority, identity or billing columns are writable.\nGRANT UPDATE(name) ON public.accounts TO cw_control;\n";
export function historicalRuntime(sha: typeof ORIGINAL_SHA | typeof RELEASE_A_SHA | typeof RELEASE_B_SHA) {
  const source = sha === ORIGINAL_SHA ? ORIGINAL_SOURCE : sha === RELEASE_A_SHA ? RELEASE_A_SOURCE : RELEASE_B_SOURCE;
  expect(createHash("sha256").update(source).digest("hex")).toBe(sha === ORIGINAL_SHA ? HISTORICAL_SOURCE_CHECKSUMS.original : sha === RELEASE_A_SHA ? HISTORICAL_SOURCE_CHECKSUMS.releaseA : HISTORICAL_SOURCE_CHECKSUMS.releaseB);
  const context = {exports:{} as {migrationHistoryReady:(rows:unknown)=>boolean; MIGRATIONS:readonly Migration[]; FORWARD_COMPATIBILITY?:readonly {id:string;checksum:string}[]; validateMigrationHistory:(rows:unknown)=>Set<string>}};
  runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context, {timeout:1000});
  return context.exports;
}
export async function verifyCompatibilityDatabase(control: Pool, mcp: Pool, migrator: Pool) {
  const migrations = await loadMigrations(MIGRATIONS, new URL("../../../database/migrations/", import.meta.url));
  const original = historicalRuntime(ORIGINAL_SHA), rollback = historicalRuntime(RELEASE_A_SHA), next = historicalRuntime(RELEASE_B_SHA);
  const rows = async () => (await control.query("SELECT id, checksum FROM public.schema_migrations ORDER BY id")).rows;
  const before = await rows();
  const snapshot = async () => (await migrator.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.accounts a) accounts,
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.entitlements e) entitlements,
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY to_jsonb(b)::text) FROM public.external_mcp_identities b) bindings,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY to_jsonb(c)::text) FROM public.connectwise_connections c) connections,
    (SELECT to_regclass('public.account_billing') IS NULL) billing_absent`)).rows;
  const data = await snapshot();
  const acl = async () => (await migrator.query("SELECT relacl::text FROM pg_class WHERE oid='public.schema_migrations'::regclass")).rows;
  const privileges = await acl();
  expect(original.migrationHistoryReady(before)).toBe(true);
  expect(rollback.migrationHistoryReady(before)).toBe(true);
  expect(next.migrationHistoryReady(before)).toBe(false);
  expect(await migrationReadiness(control)).toBe(false);expect(await migrationReadiness(mcp)).toBe(false);
  const future = rollback.FORWARD_COMPATIBILITY![0];
  expect(createHash("sha256").update(FUTURE_SQL).digest("hex")).toBe(future.checksum);
  expect(migrations.find(m=>m.id===future.id)).toMatchObject({...future,requirement:"core",sql:FUTURE_SQL});
  const result=await migrate(migrator,migrations,[]);
  expect(result).toMatchObject({applied:1,appliedIds:[future.id],requirements:["core"],deferredIds:["0006_test_billing_foundation","0007_test_billing_checkout"],installedOptionalIds:[]});
  expect(original.migrationHistoryReady(await rows())).toBe(false);
  expect(rollback.migrationHistoryReady(await rows())).toBe(true);
  expect(next.migrationHistoryReady(await rows())).toBe(true);
  expect(await migrationReadiness(control)).toBe(true);expect(await migrationReadiness(mcp)).toBe(true);
  const releaseAPackage=migrations.filter(m=>rollback.MIGRATIONS.some(known=>known.id===m.id));
  await expect(migrate(migrator,releaseAPackage,[])).rejects.toThrow("migration_failed");
  expect((await migrate(migrator,migrations,[])).appliedIds).toEqual([]);
  expect((await rows()).map(row=>row.id)).toEqual([...before.map(row=>row.id), future.id]);
  expect(await snapshot()).toEqual(data);expect(await acl()).toEqual(privileges);
  for (const db of [control, mcp]) {
    await expect(db.query("INSERT INTO public.schema_migrations(id,checksum) VALUES('9999_unknown',$1)",["a".repeat(64)])).rejects.toThrow();
    await expect(db.query("UPDATE public.schema_migrations SET checksum=$1",["a".repeat(64)])).rejects.toThrow();
    await expect(db.query("DELETE FROM public.schema_migrations")).rejects.toThrow();
  }
  const publicGrants = await migrator.query("SELECT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.schema_migrations'::regclass AND a.grantee=0 AND a.privilege_type IN ('INSERT','UPDATE','DELETE')) AS writable");
  expect(publicGrants.rows[0].writable).toBe(false);
  return result;
}
