import { expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { CustomerStore } from "../../control-plane/auth/store.js";
import { McpLinkStore } from "../../control-plane/auth/mcp-link-store.js";
import { AccountAccessStore, createCustomerConfigProvider } from "../../auth/customer-access.js";
import { CUSTOMER_VAULT_URI, secretNames } from "../../connections/vault.js";
export async function verifyMcpDatabase(control:Pool,mcp:Pool,migrator:Pool) {
  const issuer="https://identity.example/v1/apps/agentic/Ptest/RStest",customers=new CustomerStore(control),links=new McpLinkStore(control,issuer);
  const identity={tenantId:"11111111-1111-4111-8111-111111111111",objectId:"12121212-1212-4212-8212-121212121212",email:"shared-synthetic@example.invalid"};
  const a=await customers.login(identity),b=await customers.login({...identity,objectId:"34343434-3434-4434-8434-343434343434"});
  const pa={issuer,subject:"synthetic-mcp-a"},pb={issuer,subject:"synthetic-mcp-b"};
  await links.begin(a.context,a.token,"synthetic-once");await expect(links.consume(b.context,b.token,"synthetic-once")).rejects.toThrow();
  await links.consume(a.context,a.token,"synthetic-once");await expect(links.consume(a.context,a.token,"synthetic-once")).rejects.toThrow();
  await links.link(a.context,a.token,pa);await links.link(a.context,a.token,pa);
  await expect(links.link(b.context,b.token,pa)).rejects.toThrow();await links.link(b.context,b.token,pb);
  expect(await links.status(a.context)).toEqual({linked:true});
  expect((await control.query("SELECT user_id FROM public.external_mcp_identities WHERE issuer=$1 AND subject=$2",[issuer,pa.subject])).rows[0].user_id).toBe(a.context.userId);
  await customers.login({...identity,email:"changed-synthetic@example.invalid"});
  await links.begin(a.context,a.token,"synthetic-expired");await migrator.query("UPDATE public.mcp_link_attempts SET expires_at=now()-interval '1 second' WHERE user_id=$1",[a.context.userId]);
  await expect(links.consume(a.context,a.token,"synthetic-expired")).rejects.toThrow();
  const add=async(context:typeof a.context,url:string)=>{
    const id=randomUUID();await control.query(`INSERT INTO public.connectwise_connections(id,account_id,server_url,company_id,status,public_secret_ref,private_secret_ref,validated_at)
      VALUES($1,$2,$3,$4,'connected',$5,$6,now())`,[id,context.accountId,url,context.userId,
      `${CUSTOMER_VAULT_URI}/secrets/${secretNames(id).publicKey}/${"a".repeat(32)}`,`${CUSTOMER_VAULT_URI}/secrets/${secretNames(id).privateKey}/${"b".repeat(32)}`]);return id;
  };
  const idA=await add(a.context,"https://manage.customer-a.com");
  const access=new AccountAccessStore(mcp,issuer),read=vi.fn(async(_connection:unknown)=>({publicKey:"synthetic-public",privateKey:"synthetic-private"})),provider=createCustomerConfigProvider(access,{read});
  await expect(provider({issuer,subject:"unknown-admin-only"})).rejects.toThrow("access_denied");expect(read).not.toHaveBeenCalled();
  await expect(provider(pb)).rejects.toThrow("setup_required");expect(read).not.toHaveBeenCalled();
  const idB=await add(b.context,"https://api-na.myconnectwise.net");
  const configs=await Promise.all([provider(pa),provider(pb)]);expect(configs[0].baseUrl).toBe("https://manage.customer-a.com");expect(configs[1].baseUrl).toBe("https://api-na.myconnectwise.net");
  expect(read.mock.calls[0][0]).toMatchObject({connectionId:idA,accountId:a.context.accountId});expect(read.mock.calls[1][0]).toMatchObject({connectionId:idB,accountId:b.context.accountId});
  read.mockClear();await migrator.query("UPDATE public.entitlements SET status='suspended' WHERE account_id=$1",[a.context.accountId]);
  await expect(provider(pa)).rejects.toThrow("access_denied");expect(read).not.toHaveBeenCalled();expect((await provider(pb)).baseUrl).toBe(configs[1].baseUrl);
  await migrator.query("UPDATE public.entitlements SET status='active' WHERE account_id=$1",[a.context.accountId]);
  await migrator.query("DELETE FROM public.connectwise_connections WHERE account_id=$1",[a.context.accountId]);read.mockClear();
  await expect(provider(pa)).rejects.toThrow("setup_required");expect(read).not.toHaveBeenCalled();expect((await provider(pb)).baseUrl).toBe(configs[1].baseUrl);
  await customers.logout(a.token);await expect(links.link(a.context,a.token,pa)).rejects.toThrow();
  for(const sql of ["SELECT token_hash FROM public.auth_sessions","SELECT * FROM public.mcp_link_attempts","SELECT contact_email FROM public.users",
    "UPDATE public.entitlements SET status='active'","DELETE FROM public.connectwise_connections","SET ROLE cw_control","CREATE TABLE public.mcp_forbidden(id int)"])
    await expect(mcp.query(sql)).rejects.toThrow();
}
