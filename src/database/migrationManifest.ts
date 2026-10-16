export const MIGRATIONS = Object.freeze([
  { id: "0001_delivery_foundation", file: "0001_delivery_foundation.sql", checksum: "628acc7d80cd8134a6bb25c8adfa1b0a58b99c12c94acfc6377aaf94790544f1", requirement: "core" },
  { id: "0002_customer_foundation", file: "0002_customer_foundation.sql", checksum: "6e2682435970f69e090e5d4dd52e01eea33d10a649db3302f93ac6b46b070651", requirement: "core" },
  { id: "0003_connectwise_connections", file: "0003_connectwise_connections.sql", checksum: "6c8ecf4ae43946aa16bfe6de8937a8f5edf7b368c4a7ca081392fda4fad31e29", requirement: "core" },
  { id: "0004_mcp_identity_linkage", file: "0004_mcp_identity_linkage.sql", checksum: "cc4336854dafdc575fd5631d0fa07e62937202dfce52a2f4b9fb0de7d44f9c07", requirement: "core" },
  { id: "0005_web_paid_entitlement", file: "0005_web_paid_entitlement.sql", checksum: "35f4a74eb6f061365cc7d4a8392648e00ea2cc0b7704c8b0dbcfafe7d2eadb5a", requirement: "core" },
  { id: "0006_test_billing_foundation", file: "0006_test_billing_foundation.sql", checksum: "27b128d14c18f48668489ec6ce463a1b64dc0c946632abcde76c7e3481900ecc", requirement: "billing" },
  { id: "0007_test_billing_checkout", file: "0007_test_billing_checkout.sql", checksum: "cf319314cc19a8daf7782bf23c7166160d7f7aa50eb0a60c86f58d32a8006e83", requirement: "billing" },
  { id: "0008_account_name_edit", file: "0008_account_name_edit.sql", checksum: "db9c40c882343deb5eec9d26b06355665807e22ba7075ada0cf66efaf6977729", requirement: "core" }
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
