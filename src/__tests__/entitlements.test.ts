import { describe,it,expect,vi } from "vitest";
import { evaluateEntitlements,VALID_ENTITLEMENT_SQL,ACCOUNT_ENTITLEMENTS_SQL } from "../entitlements/service.js";
import { ENTITLEMENT_CASES,grant,EVALUATED_AT } from "./fixtures/entitlement-cases.js";
import { CustomerStore } from "../control-plane/auth/store.js";
import { AccountAccessStore,createCustomerConfigProvider } from "../auth/customer-access.js";
const uid="11111111-1111-4111-8111-111111111111",aid="22222222-2222-4222-8222-222222222222";
describe("shared effective entitlement",()=>{
 it.each(ENTITLEMENT_CASES)("$name",({rows,allowed})=>{
  expect(evaluateEntitlements(rows).allowed).toBe(allowed);
  expect(evaluateEntitlements([...rows].reverse()).allowed).toBe(allowed);
 });
 it("honors the computed DB predicate without rounding an exclusive boundary",()=>{
  expect(evaluateEntitlements([grant("comp",{ends_at:EVALUATED_AT,valid_at_evaluation:true})]).allowed).toBe(true);
  expect(evaluateEntitlements([grant("comp",{valid_at_evaluation:false})]).allowed).toBe(false);
  expect(evaluateEntitlements([grant("comp",{valid_at_evaluation:"true"})]).allowed).toBe(false);
 });
 it("keeps trial history independent from generic nontrial presentation",()=>{
  const trial=grant();const before=evaluateEntitlements([trial]);
  const paid=evaluateEntitlements([trial,grant("web_paid")]);
  expect(before.accessKind).toBe("trial");expect(paid.accessKind).toBe("standard");expect(paid.trial).toEqual(before.trial);
  expect(JSON.stringify(paid)).not.toMatch(/web_paid|substack|comp/);
 });
 it("retains the deployed portal's trial fields without exposing other sources",()=>{
  const t=evaluateEntitlements([grant()]);expect(t).toMatchObject({source:"trial",expiresAt:"2026-11-01T00:00:00.000Z"});
  const paid=evaluateEntitlements([grant("web_paid",{ends_at:null})]);expect(paid).toMatchObject({source:null,expiresAt:null,accessKind:"standard"});
 });
 it("invalid trial dates cannot throw through a valid paid grant",()=>{
  expect(evaluateEntitlements([grant("trial",{starts_at:new Date(NaN)}),grant("web_paid")])).toMatchObject({allowed:true,trial:null});
 });
 it("rejects invalid or inconsistent database evaluation clocks",()=>{
  expect(()=>evaluateEntitlements([grant("comp",{evaluated_at:new Date(NaN)})])).toThrow("entitlement_evaluation_failed");
  expect(()=>evaluateEntitlements([grant(),grant("comp",{evaluated_at:new Date(EVALUATED_AT.getTime()+1)})])).toThrow();
 });
 it("uses the approved predicate with statement time and parameterized account SQL",()=>{
  expect(VALID_ENTITLEMENT_SQL).toContain("isfinite(e.starts_at)");expect(VALID_ENTITLEMENT_SQL).toContain("e.ends_at IS NULL");
  expect(VALID_ENTITLEMENT_SQL).toContain("statement_timestamp()<e.ends_at");expect(ACCOUNT_ENTITLEMENTS_SQL).toContain("e.account_id=$1");
  expect(ACCOUNT_ENTITLEMENTS_SQL).not.toContain("source='trial'");
 });
});
describe("portal entitlement ownership and presentation",()=>{
 it.each(ENTITLEMENT_CASES)("$name status",async({rows,allowed})=>{
  const query=vi.fn(async()=>({rows:rows.length?rows:[{source:null,status:null,starts_at:null,ends_at:null,evaluated_at:EVALUATED_AT}]}));
  const result=await new CustomerStore({query} as never).status({userId:uid,accountId:aid,name:null});
  expect(result.entitlement.allowed).toBe(allowed);expect(query.mock.calls[0]).toEqual([expect.stringContaining("m.role='owner'"),[aid,uid]]);
 });
 it("does not confuse missing entitlement with invalid ownership",async()=>{
  await expect(new CustomerStore({query:async()=>({rows:[]})} as never).status({userId:uid,accountId:aid,name:null})).rejects.toThrow("customer_auth_failed");
 });
});
describe("MCP entitlement boundary",()=>{
 it.each(ENTITLEMENT_CASES)("$name before connection/secret/CW",async({rows,allowed})=>{
  const query=vi.fn(async(sql:string)=>({rows:sql.includes("external_mcp_identities")?[{user_id:uid,account_id:aid}]:sql.includes("entitlements")?rows:[]}));
  const read=vi.fn();const store=new AccountAccessStore({query} as never,"issuer");
  await expect(createCustomerConfigProvider(store,{read})({issuer:"issuer",subject:"synthetic"})).rejects.toThrow(allowed?"setup_required":"access_denied");
  expect(query.mock.calls.some(([sql])=>sql.includes("connectwise_connections"))).toBe(allowed);expect(read).not.toHaveBeenCalled();
 });
 it("J database failure denies before connection and secret lookup",async()=>{
  const query=vi.fn(async(sql:string)=>{if(sql.includes("entitlements"))throw Error("private-db-canary");return{rows:[{user_id:uid,account_id:aid}]};});
  const read=vi.fn();await expect(createCustomerConfigProvider(new AccountAccessStore({query} as never,"issuer"),{read})({issuer:"issuer",subject:"synthetic"})).rejects.toThrow("service_unavailable");
  expect(query).toHaveBeenCalledTimes(2);expect(read).not.toHaveBeenCalled();
 });
});
