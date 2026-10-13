import type { Pool } from "pg";
import { ACCOUNT_ENTITLEMENTS_SQL, evaluateEntitlements, type EntitlementRow } from "../entitlements/service.js";
import { UUID } from "../control-plane/auth/identity.js";
import { validMcpPrincipal, type McpPrincipal } from "./descope-mcp.js";
import { normalizeTarget } from "../security/outbound-target.js";
import { validReference } from "../connections/vault.js";
import { GLOBAL_CLIENT_ID } from "../connections/validation-transport.js";
import type { CwManageConfig } from "../config.js";
export class CustomerAccessError extends Error {
  constructor(readonly code: "access_denied" | "setup_required" | "service_unavailable" = "access_denied") { super(code); }
}
export interface AuthorizedConnection {
  readonly userId: string; readonly accountId: string; readonly connectionId: string;
  readonly baseUrl: string; readonly companyId: string; readonly publicRef: string; readonly privateRef: string;
}
export interface CustomerAccessStore { resolve(principal: McpPrincipal): Promise<AuthorizedConnection> }
export interface CredentialReader { read(connection: AuthorizedConnection): Promise<{ publicKey: string; privateKey: string }> }
/** No caller-selected account, no identity creation, no profile/email lookup and no cached authorization. */
export class AccountAccessStore implements CustomerAccessStore {
  constructor(private readonly pool: Pick<Pool, "query">, private readonly issuer: string) {}
  async resolve(principal: McpPrincipal): Promise<AuthorizedConnection> {
    try {
      if (!validMcpPrincipal(principal) || principal.issuer !== this.issuer) throw new CustomerAccessError();
      const identity = await this.pool.query<{ user_id: string; account_id: string }>(`SELECT u.id AS user_id,a.id AS account_id
        FROM public.external_mcp_identities x JOIN public.users u ON u.id=x.user_id
        JOIN public.account_memberships m ON m.user_id=u.id JOIN public.accounts a ON a.id=m.account_id
        WHERE x.issuer=$1 AND x.subject=$2 AND u.status='active' AND a.status='active' AND m.role='owner'`, [principal.issuer,principal.subject]);
      if (identity.rows.length !== 1 || !UUID.test(identity.rows[0].user_id) || !UUID.test(identity.rows[0].account_id)) throw new CustomerAccessError();
      const { user_id: userId, account_id: accountId } = identity.rows[0];
      const entitlement = await this.pool.query<EntitlementRow>(ACCOUNT_ENTITLEMENTS_SQL,[accountId]);
      if (!evaluateEntitlements(entitlement.rows).allowed) throw new CustomerAccessError();
      const connections = await this.pool.query<{ id: string; server_url: string; company_id: string; public_secret_ref: string; private_secret_ref: string }>(
        "SELECT id,server_url,company_id,public_secret_ref,private_secret_ref FROM public.connectwise_connections WHERE account_id=$1 AND status='connected'",[accountId]);
      if (connections.rows.length !== 1) throw new CustomerAccessError("setup_required");
      const c = connections.rows[0];
      if (!UUID.test(c.id) || !validReference(c.id,"publicKey",c.public_secret_ref) || !validReference(c.id,"privateKey",c.private_secret_ref) ||
          typeof c.company_id !== "string" || !c.company_id || c.company_id.length > 100) throw new CustomerAccessError();
      const target = normalizeTarget(c.server_url);
      return Object.freeze({userId,accountId,connectionId:c.id,baseUrl:target.baseUrl,companyId:c.company_id,
        publicRef:c.public_secret_ref,privateRef:c.private_secret_ref});
    } catch (error) { if (error instanceof CustomerAccessError) throw error; throw new CustomerAccessError("service_unavailable"); }
  }
}
export function createCustomerConfigProvider(store: CustomerAccessStore, reader: CredentialReader) {
  return async (principal: McpPrincipal): Promise<Readonly<CwManageConfig>> => {
    const connection = await store.resolve(principal); // Entitlement and both references verified before any key read.
    try {
      const {publicKey,privateKey} = await reader.read(connection);
      if (!publicKey || !privateKey) throw new Error();
      return Object.freeze({baseUrl:connection.baseUrl,companyId:connection.companyId,publicKey,privateKey,
        clientId:GLOBAL_CLIENT_ID,rejectUnauthorized:true});
    } catch { throw new CustomerAccessError("service_unavailable"); }
  };
}
