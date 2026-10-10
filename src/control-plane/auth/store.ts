import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CustomerAuthError, type MicrosoftIdentity, UUID } from "./identity.js";
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const SESSION_SECONDS = 24 * 60 * 60;
export const FLOW_SECONDS = 10 * 60;
export interface CustomerContext { userId: string; accountId: string; name: string | null }
export interface Trial { source: "trial"; status: string; startsAt: Date; endsAt: Date }
export function evaluateTrial(trial: Trial | null, now = new Date()) {
  const allow = !!trial && trial.status === "active" && trial.startsAt.getTime() <= now.getTime() && trial.endsAt.getTime() > now.getTime();
  return { allowed: allow, source: trial?.source ?? null, status: allow ? "active" : trial?.status === "active" ? "expired" : trial?.status ?? "absent",
    expiresAt: trial?.endsAt.toISOString() ?? null };
}
export class CustomerStore {
  constructor(private readonly pool: Pool) {}
  async login(identity: MicrosoftIdentity): Promise<{ token: string; context: CustomerContext }> {
    if (!UUID.test(identity.tenantId) || !UUID.test(identity.objectId)) throw new CustomerAuthError();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='10s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`microsoft:${identity.tenantId}:${identity.objectId}`]);
      const mapping = await client.query<{ user_id: string }>("SELECT user_id FROM public.external_identities WHERE provider='microsoft' AND tenant_id=$1 AND object_id=$2", [identity.tenantId, identity.objectId]);
      let userId: string;
      if (mapping.rows.length === 0) {
        userId = randomUUID(); const accountId = randomUUID();
        await client.query("INSERT INTO public.users(id,display_name,contact_email) VALUES($1,$2,$3)", [userId, identity.name ?? null, identity.email ?? null]);
        await client.query("INSERT INTO public.accounts(id,name,acquisition_source) VALUES($1,$2,'web')", [accountId, identity.name ?? null]);
        await client.query("INSERT INTO public.account_memberships(user_id,account_id,role) VALUES($1,$2,'owner')", [userId, accountId]);
        await client.query("INSERT INTO public.external_identities(provider,tenant_id,object_id,user_id) VALUES('microsoft',$1,$2,$3)", [identity.tenantId, identity.objectId, userId]);
        await client.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,'trial','active',now(),now()+interval '720 hours')", [randomUUID(), accountId]);
      } else if (mapping.rows.length === 1) {
        userId = mapping.rows[0].user_id;
        await client.query("UPDATE public.users SET display_name=$2,contact_email=$3 WHERE id=$1", [userId, identity.name ?? null, identity.email ?? null]);
      } else throw new CustomerAuthError();
      const resolved = await client.query<{ user_id: string; account_id: string; name: string | null }>("SELECT u.id AS user_id,a.id AS account_id,a.name FROM public.users u JOIN public.account_memberships m ON m.user_id=u.id JOIN public.accounts a ON a.id=m.account_id WHERE u.id=$1 AND u.status='active' AND a.status='active' AND m.role='owner'", [userId]);
      if (resolved.rows.length !== 1) throw new CustomerAuthError();
      const row = resolved.rows[0];
      const token = randomBytes(32).toString("base64url");
      await client.query("INSERT INTO public.auth_sessions(token_hash,user_id,account_id,expires_at) VALUES($1,$2,$3,now()+interval '24 hours')", [hashToken(token), row.user_id, row.account_id]);
      await client.query("COMMIT");
      return { token, context: { userId: row.user_id, accountId: row.account_id, name: row.name } };
    } catch { await client.query("ROLLBACK").catch(() => {}); throw new CustomerAuthError(); }
    finally { client.release(); }
  }
  async session(token: string | undefined): Promise<CustomerContext | null> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const r = await this.pool.query<{ user_id: string; account_id: string; name: string | null }>(`SELECT s.user_id,s.account_id,a.name FROM public.auth_sessions s
      JOIN public.users u ON u.id=s.user_id JOIN public.account_memberships m ON m.user_id=s.user_id AND m.account_id=s.account_id
      JOIN public.accounts a ON a.id=m.account_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
      AND u.status='active' AND a.status='active' AND m.role='owner'`, [hashToken(token)]);
    if (r.rows.length !== 1) return null;
    const row = r.rows[0]; return { userId: row.user_id, accountId: row.account_id, name: row.name };
  }
  async status(context: CustomerContext) {
    // Re-resolve ownership even if a caller accidentally supplies a foreign context.
    const r = await this.pool.query<{ source: "trial"; status: string; starts_at: Date; ends_at: Date; evaluated_at: Date }>(`SELECT e.source,e.status,e.starts_at,e.ends_at,now() AS evaluated_at FROM public.entitlements e
      JOIN public.account_memberships m ON m.account_id=e.account_id JOIN public.accounts a ON a.id=m.account_id
      JOIN public.users u ON u.id=m.user_id WHERE e.account_id=$1 AND m.user_id=$2 AND m.role='owner'
      AND u.status='active' AND a.status='active' AND e.source='trial'`, [context.accountId, context.userId]);
    if (r.rows.length !== 1) throw new CustomerAuthError();
    const t = r.rows[0];
    return { account: { id: context.accountId, name: context.name }, entitlement: evaluateTrial({ source: t.source, status: t.status, startsAt: t.starts_at, endsAt: t.ends_at }, t.evaluated_at),
      connectwise: { status: "not_configured" }, nextAction: "connect_connectwise" };
  }
  async logout(token: string | undefined) {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await this.pool.query("UPDATE public.auth_sessions SET revoked_at=now() WHERE token_hash=$1", [hashToken(token)]);
  }
  async beginFlow(state: string) {
    await this.pool.query("DELETE FROM public.auth_login_attempts WHERE state_hash IN (SELECT state_hash FROM public.auth_login_attempts WHERE expires_at<=now() LIMIT 100)");
    await this.pool.query("INSERT INTO public.auth_login_attempts(state_hash,expires_at) VALUES($1,now()+interval '10 minutes')", [hashToken(state)]);
  }
  async consumeFlow(state: string) {
    const r = await this.pool.query("DELETE FROM public.auth_login_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING state_hash", [hashToken(state)]);
    if (r.rowCount !== 1) throw new CustomerAuthError();
  }
}
