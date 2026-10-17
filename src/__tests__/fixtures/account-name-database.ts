import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { Pool } from "pg";
import { CustomerStore } from "../../control-plane/auth/store.js";
import { AccountAccessStore, createCustomerConfigProvider } from "../../auth/customer-access.js";
import { ConnectionStore } from "../../connections/store.js";
import { ConnectionService } from "../../connections/service.js";
import { CUSTOMER_VAULT_URI, secretNames } from "../../connections/vault.js";
export async function verifyAccountNameDatabase(control: Pool, mcp: Pool, migrator: Pool) {
  const customers = new CustomerStore(control), identity = { tenantId: randomUUID(), objectId: randomUUID(), name: "Signup seed" };
  const a = await customers.login(identity), b = await customers.login({ ...identity, objectId: randomUUID(), name: "Other account" });
  const writer = { write: async (id: string) => { const n = secretNames(id); return { publicRef: `${CUSTOMER_VAULT_URI}/secrets/${n.publicKey}/${"a".repeat(32)}`, privateRef: `${CUSTOMER_VAULT_URI}/secrets/${n.privateKey}/${"b".repeat(32)}` }; }, cleanup: async () => {} };
  await new ConnectionService(new ConnectionStore(control), () => writer, async () => {}).setup(a.context, { url: "https://custom.example.com", companyId: "account-name-fixture", publicKey: "synthetic-public", privateKey: "synthetic-private" });
  const principal = { issuer: "https://identity.example/account-name", subject: randomUUID() };
  await control.query("INSERT INTO external_mcp_identities(issuer,subject,user_id) VALUES($1,$2,$3)", [principal.issuer, principal.subject, a.context.userId]);
  await control.query("INSERT INTO account_billing(account_id,stripe_customer_id,stripe_price_id) VALUES($1,$2,'price_namefixture')", [a.context.accountId, "cus_" + randomUUID().replaceAll("-", "")]);
  for (const source of ["comp", "substack", "web_paid"]) await control.query("INSERT INTO entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,$3,$4,now(),NULL)", [randomUUID(), a.context.accountId, source, source === "web_paid" ? "canceled" : "active"]);
  const provider = createCustomerConfigProvider(new AccountAccessStore(mcp, principal.issuer), { read: async () => ({ publicKey: "synthetic-public", privateKey: "synthetic-private" }) });
  const snapshot = async () => (await control.query(`SELECT
    (SELECT row_to_json(a) FROM accounts a WHERE id=$1) account,
    (SELECT row_to_json(u) FROM users u WHERE id=$2) user_record,
    (SELECT json_agg(m ORDER BY user_id) FROM account_memberships m WHERE account_id=$1) memberships,
    (SELECT json_agg(x ORDER BY provider) FROM external_identities x WHERE user_id=$2) identities,
    (SELECT json_agg(e ORDER BY id) FROM entitlements e WHERE account_id=$1) entitlements,
    (SELECT json_agg(c ORDER BY id) FROM connectwise_connections c WHERE account_id=$1) connections,
    (SELECT json_agg(x ORDER BY issuer,subject) FROM external_mcp_identities x WHERE user_id=$2) bindings,
    (SELECT json_agg(s ORDER BY token_hash) FROM auth_sessions s WHERE account_id=$1) sessions,
    (SELECT row_to_json(b) FROM account_billing b WHERE account_id=$1) billing`, [a.context.accountId, a.context.userId])).rows[0];
  const before = await snapshot(), accessBefore = await provider(principal);
  expect(await customers.rename(a.context, "  Corrected MSP  ")).toEqual({ name: "Corrected MSP" });
  const after = await snapshot(); expect(after).toEqual({ ...before, account: { ...before.account, name: "Corrected MSP" } });
  const fresh = await customers.session(a.token); expect(fresh).toEqual({ ...a.context, name: "Corrected MSP" });
  expect((await customers.status(fresh!)).account).toEqual({ id: a.context.accountId, name: "Corrected MSP" });
  expect(await provider(principal)).toEqual(accessBefore);
  await expect(customers.rename({ ...b.context, accountId: a.context.accountId }, "Foreign")).rejects.toMatchObject({ code: "forbidden" });
  expect((await snapshot()).account.name).toBe("Corrected MSP");
  for (const value of ["", "  ", "bad\nname", "x".repeat(121)]) await expect(customers.rename(a.context, value)).rejects.toMatchObject({ code: "invalid_name" });
  for (const table of ["users", "accounts"]) {
    const id = table === "users" ? a.context.userId : a.context.accountId;
    await migrator.query(`UPDATE ${table} SET status='disabled' WHERE id=$1`, [id]);
    try { await expect(customers.rename(a.context, "No access")).rejects.toMatchObject({ code: "forbidden" }); }
    finally { await migrator.query(`UPDATE ${table} SET status='active' WHERE id=$1`, [id]); }
  }
  expect((await control.query("SELECT has_column_privilege('cw_control','public.accounts','name','UPDATE') allowed,has_table_privilege('cw_control','public.accounts','UPDATE') blanket")).rows[0]).toEqual({ allowed: true, blanket: false });
  for (const column of ["id", "status", "acquisition_source", "created_at"]) expect((await control.query("SELECT has_column_privilege('cw_control','public.accounts',$1,'UPDATE') allowed", [column])).rows[0].allowed).toBe(false);
  await expect(control.query("UPDATE accounts SET status='disabled' WHERE id=$1", [a.context.accountId])).rejects.toThrow();
  await expect(mcp.query("UPDATE accounts SET name='Forbidden' WHERE id=$1", [a.context.accountId])).rejects.toThrow();
  // Signing in again can refresh identity display claims, but must never overwrite the edited account label.
  const again = await customers.login({ ...identity, name: "Fresh identity claim" }); expect(again.context.accountId).toBe(a.context.accountId); expect(again.context.name).toBe("Corrected MSP");
  expect(await provider(principal)).toEqual(accessBefore);
}
