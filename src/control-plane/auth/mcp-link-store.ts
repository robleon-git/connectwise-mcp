import type { Pool } from "pg";
import { CustomerAuthError } from "./identity.js";
import { hashToken, type CustomerContext } from "./store.js";
import { validMcpPrincipal, type McpPrincipal } from "../../auth/descope-mcp.js";
const eligible = `SELECT 1 FROM public.auth_sessions s JOIN public.users u ON u.id=s.user_id
  JOIN public.account_memberships m ON m.user_id=s.user_id AND m.account_id=s.account_id JOIN public.accounts a ON a.id=m.account_id
  WHERE s.token_hash=$3 AND s.user_id=$1 AND s.account_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
  AND u.status='active' AND a.status='active' AND m.role='owner'`;
export class McpLinkStore {
  constructor(private readonly pool: Pick<Pool,"query">, private readonly issuer: string) {}
  async begin(context: CustomerContext, session: string, state: string) {
    const hash = hashToken(session);
    await this.pool.query("DELETE FROM public.mcp_link_attempts WHERE state_hash IN (SELECT state_hash FROM public.mcp_link_attempts WHERE expires_at<=clock_timestamp() LIMIT 100)");
    const result = await this.pool.query(`INSERT INTO public.mcp_link_attempts(state_hash,session_hash,user_id,account_id,expires_at)
      SELECT $4,$3,$1,$2,clock_timestamp()+interval '10 minutes' WHERE EXISTS(${eligible})
      ON CONFLICT (session_hash) DO UPDATE SET state_hash=EXCLUDED.state_hash,expires_at=EXCLUDED.expires_at RETURNING state_hash`,
      [context.userId,context.accountId,hash,hashToken(state)]);
    if (result.rowCount !== 1) throw new CustomerAuthError();
  }
  async consume(context: CustomerContext, session: string, state: string) {
    const result = await this.pool.query(`DELETE FROM public.mcp_link_attempts WHERE user_id=$1 AND account_id=$2 AND session_hash=$3
      AND state_hash=$4 AND expires_at>clock_timestamp() AND EXISTS(${eligible}) RETURNING state_hash`,
      [context.userId,context.accountId,hashToken(session),hashToken(state)]);
    if (result.rowCount !== 1) throw new CustomerAuthError();
  }
  async link(context: CustomerContext, session: string, principal: McpPrincipal) {
    if (!validMcpPrincipal(principal) || principal.issuer !== this.issuer) throw new CustomerAuthError();
    const values = [context.userId,context.accountId,hashToken(session),principal.issuer,principal.subject];
    // Atomic uniqueness prevents two customers from claiming the same principal. No reassignment/unlink override.
    await this.pool.query(`INSERT INTO public.external_mcp_identities(issuer,subject,user_id)
      SELECT $4,$5,$1 WHERE EXISTS(${eligible}) ON CONFLICT DO NOTHING`,values);
    const result = await this.pool.query(`SELECT 1 FROM public.external_mcp_identities x WHERE x.issuer=$4 AND x.subject=$5
      AND x.user_id=$1 AND EXISTS(${eligible})`,values);
    if (result.rows.length !== 1) throw new CustomerAuthError();
  }
  async status(context: CustomerContext) {
    const result = await this.pool.query(`SELECT 1 FROM public.external_mcp_identities x
      JOIN public.users u ON u.id=x.user_id JOIN public.account_memberships m ON m.user_id=u.id JOIN public.accounts a ON a.id=m.account_id
      WHERE x.user_id=$1 AND m.account_id=$2 AND x.issuer=$3 AND m.role='owner' AND u.status='active' AND a.status='active'`,
      [context.userId,context.accountId,this.issuer]);
    return { linked: result.rows.length === 1 };
  }
}
