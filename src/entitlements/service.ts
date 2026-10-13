/** Product access is local account metadata; no provider or authentication dependency. */
export const ENTITLEMENT_SOURCES = ["trial", "web_paid", "substack", "comp"] as const;
export interface EntitlementRow {
  source: unknown; status: unknown; starts_at: unknown; ends_at: unknown; evaluated_at: unknown;
  valid_at_evaluation?: unknown;
}
function finiteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
export function validGrant(grant: EntitlementRow, time: Date): boolean {
  if (!finiteDate(time) || !ENTITLEMENT_SOURCES.some(source => source === grant.source) || grant.status !== "active" ||
      !finiteDate(grant.starts_at) || grant.ends_at !== null && !finiteDate(grant.ends_at)) return false;
  // Real database reads supply this computed predicate. Preserve PostgreSQL's sub-millisecond boundaries.
  if (Object.hasOwn(grant,"valid_at_evaluation")) return grant.valid_at_evaluation === true;
  return grant.starts_at.getTime() <= time.getTime() && (grant.ends_at === null || finiteDate(grant.ends_at) &&
    grant.ends_at.getTime() > grant.starts_at.getTime() && time.getTime() < grant.ends_at.getTime());
}
// Only the fixed internal e alias is used. Values identifying an account remain query parameters.
export const VALID_ENTITLEMENT_SQL = `e.source IN (${ENTITLEMENT_SOURCES.map(source => `'${source}'`).join(",")})
  AND e.status='active' AND isfinite(e.starts_at) AND e.starts_at<=statement_timestamp()
  AND (e.ends_at IS NULL OR (isfinite(e.ends_at) AND e.ends_at>e.starts_at AND statement_timestamp()<e.ends_at))`;
export const ENTITLEMENT_COLUMNS_SQL = `e.source,e.status,e.starts_at,e.ends_at,statement_timestamp() AS evaluated_at,
  (${VALID_ENTITLEMENT_SQL}) AS valid_at_evaluation`;
export const ACCOUNT_ENTITLEMENTS_SQL = `SELECT ${ENTITLEMENT_COLUMNS_SQL} FROM public.entitlements e WHERE e.account_id=$1`;
export interface EffectiveEntitlement {
  allowed: boolean;
  status: "active" | "expired" | "inactive";
  accessKind: "trial" | "standard" | null;
  /** Temporary response compatibility for the deployed trial-only portal; never exposes nontrial sources. */
  source: "trial" | null;
  expiresAt: string | null;
  trial: { status: "active" | "expired" | "inactive"; startsAt: string; expiresAt: string } | null;
}
export function evaluateEntitlements(rows: readonly EntitlementRow[]): EffectiveEntitlement {
  if (rows.length === 0) return { allowed: false, status: "inactive", accessKind: null, source: null, expiresAt: null, trial: null };
  const time = rows[0].evaluated_at;
  if (!finiteDate(time) || rows.some(row => !finiteDate(row.evaluated_at) || row.evaluated_at.getTime() !== time.getTime()))
    throw new Error("entitlement_evaluation_failed");
  const valid = rows.filter(row => validGrant(row, time));
  // Trial history is presentation only; invalid grant dates are never formatted or thrown through another valid grant.
  const history = rows.find(row => row.source === "trial" && finiteDate(row.starts_at) && finiteDate(row.ends_at) && row.ends_at.getTime() > row.starts_at.getTime());
  const trial: EffectiveEntitlement["trial"] = history && finiteDate(history.starts_at) && finiteDate(history.ends_at) ? {
    status: validGrant(history,time) ? "active" : history.status === "active" && history.ends_at.getTime() <= time.getTime() ? "expired" : "inactive",
    startsAt: history.starts_at.toISOString(), expiresAt: history.ends_at.toISOString(),
  } : null;
  const allowed = valid.length > 0;
  const accessKind = allowed ? valid.some(row => row.source !== "trial") ? "standard" : "trial" : null;
  return { allowed, status: allowed ? "active" : trial?.status === "expired" ? "expired" : "inactive",
    accessKind, source: accessKind === "trial" || !allowed && trial !== null ? "trial" : null, expiresAt: trial?.expiresAt ?? null, trial };
}
