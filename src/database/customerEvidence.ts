import type { Pool } from "pg";
export async function customerEvidence(db: Pick<Pool, "query">) {
  const r = await db.query<{ users: string; accounts: string; memberships: string; identities: string; trials: string; trial_durations_valid: boolean; session_hashes_valid: boolean }>(`SELECT
    (SELECT count(*) FROM public.users) AS users,
    (SELECT count(*) FROM public.accounts) AS accounts,
    (SELECT count(*) FROM public.account_memberships) AS memberships,
    (SELECT count(*) FROM public.external_identities) AS identities,
    (SELECT count(*) FROM public.entitlements WHERE source='trial') AS trials,
    NOT EXISTS(SELECT 1 FROM public.entitlements WHERE source='trial' AND extract(epoch FROM ends_at-starts_at)<>2592000) AS trial_durations_valid,
    NOT EXISTS(SELECT 1 FROM public.auth_sessions WHERE token_hash !~ '^[a-f0-9]{64}$') AS session_hashes_valid`);
  const row = r.rows[0];
  if (!row) throw new Error("customer_evidence_unavailable");
  return { event: "customer.evidence", users: Number(row.users), accounts: Number(row.accounts), memberships: Number(row.memberships), identities: Number(row.identities), trials: Number(row.trials), trialDurationsValid: row.trial_durations_valid, sessionHashesValid: row.session_hashes_valid };
}
