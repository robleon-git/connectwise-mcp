import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generateKeyPair, SignJWT } from "jose";
import { createPrincipalAuthenticator, createResourceTokenVerifier } from "../auth/descope-mcp.js";
import { AccountAccessStore, createCustomerConfigProvider, CustomerAccessError } from "../auth/customer-access.js";
import { customerCredentialReader } from "../auth/customer-vault.js";
import { customerTransport } from "../auth/customer-transport.js";
import { CwManageClient } from "../api-client.js";
import { createMcpServer } from "../mcp-server.js";
import { createHttpHandler } from "../http-server.js";
import { GLOBAL_CLIENT_ID } from "../connections/validation-transport.js";
import { CUSTOMER_VAULT_URI, secretNames } from "../connections/vault.js";
// @ts-expect-error Local operator reference is JavaScript.
import { EXPECTED_READ_TOOLS } from "../../scripts/read-only-tool-inventory.mjs";
const auth = {issuer:"https://identity.example/v1/apps/agentic/Ptest/RStest",jwksUri:"https://identity.example/keys",resourceUri:"https://api.monotorr.com/mcp",requiredScope:"connectwise.read"};
const uid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", aid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cid="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const refs = {publicRef:`${CUSTOMER_VAULT_URI}/secrets/${secretNames(cid).publicKey}/${"a".repeat(32)}`,privateRef:`${CUSTOMER_VAULT_URI}/secrets/${secretNames(cid).privateKey}/${"b".repeat(32)}`};
const principal = {issuer:auth.issuer,subject:"synthetic-subject-a"};
const connection = {userId:uid,accountId:aid,connectionId:cid,baseUrl:"https://manage.example.com",companyId:"synthetic-company",...refs};
const config = {baseUrl:connection.baseUrl,companyId:connection.companyId,publicKey:"synthetic-public-secret",privateKey:"synthetic-private-secret",clientId:GLOBAL_CLIENT_ID,rejectUnauthorized:true};
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function storeFixture(options: {identity?:unknown[];entitlement?:unknown[];connection?:unknown[]} = {}) {
  const query = vi.fn(async(sql:string,_params?:unknown[])=>({rows:sql.includes("external_mcp_identities") ? options.identity ?? [{user_id:uid,account_id:aid}] :
    sql.includes("entitlements") ? options.entitlement ?? [{source:"trial",status:"active",starts_at:new Date(0),ends_at:new Date(Date.now()+100000),evaluated_at:new Date()}] :
    options.connection ?? [{id:cid,server_url:connection.baseUrl,company_id:connection.companyId,public_secret_ref:refs.publicRef,private_secret_ref:refs.privateRef}]}));
  return {query,store:new AccountAccessStore({query} as never,auth.issuer)};
}
describe("verified resource principal",()=>{
  it("returns only immutable issuer/subject and ignores mutable profile/email",async()=>{
    const pair=await generateKeyPair("RS256"),verify=createResourceTokenVerifier(auth,async()=>pair.publicKey);
    for(const email of ["synthetic-one@example.invalid","synthetic-two@example.invalid"]) {
      const token=await new SignJWT({scope:"connectwise.read",email,rawClaim:"private-claim-canary"}).setProtectedHeader({alg:"RS256"}).setIssuer(auth.issuer).setAudience(auth.resourceUri).setSubject(principal.subject).setExpirationTime("5m").sign(pair.privateKey);
      expect(await verify(token)).toEqual(principal);expect(Object.isFrozen(await verify(token))).toBe(true);
    }
  });
  it.each([{iss:"https://wrong.example"},{aud:"https://wrong.example"},{exp:1},{nbf:9999999999},{scope:"connectwise.read.extra"},{sub:""},{sub:123},{sub:"bad subject"}])("rejects malformed/resource-incompatible claims %j",async patch=>{
    const pair=await generateKeyPair("RS256"),verify=createResourceTokenVerifier(auth,async()=>pair.publicKey);
    const token=await new SignJWT({iss:auth.issuer,aud:auth.resourceUri,sub:principal.subject,scope:auth.requiredScope,exp:Math.floor(Date.now()/1000)+100,...patch} as never).setProtectedHeader({alg:"RS256"}).sign(pair.privateKey);
    await expect(verify(token)).rejects.toThrow("resource_token_rejected");
  });
});
describe("authorization before customer secrets",()=>{
  it.each([
    ["unknown/admin-only/disabled principal",{identity:[]}],
    ["ambiguous membership",{identity:[{user_id:uid,account_id:aid},{user_id:uid,account_id:aid}]}],
    ["missing entitlement",{entitlement:[]}],
    ["revoked entitlement",{entitlement:[{source:"trial",status:"suspended",starts_at:new Date(0),ends_at:new Date(Date.now()+1000),evaluated_at:new Date()}]}],
    ["expired entitlement",{entitlement:[{source:"trial",status:"active",starts_at:new Date(0),ends_at:new Date(1),evaluated_at:new Date()}]}],
    ["unconfigured customer",{connection:[]}],
    ["malformed references",{connection:[{id:cid,server_url:connection.baseUrl,company_id:"synthetic",public_secret_ref:refs.publicRef,private_secret_ref:"foreign-vault-secret"}]}],
  ] as const)("%s denies with zero Vault/ConnectWise calls",async(_name,options)=>{
    const fixture=storeFixture(options as never),read=vi.fn(),fetch=vi.fn();vi.stubGlobal("fetch",fetch);
    await expect(createCustomerConfigProvider(fixture.store,{read})(principal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  });
  it("resolves exact account/connection after generic trial allow decision, never by email",async()=>{
    const f=storeFixture(),read=vi.fn(async()=>({publicKey:config.publicKey,privateKey:config.privateKey}));
    const result=await createCustomerConfigProvider(f.store,{read})(principal);
    expect(result).toEqual(config);expect(Object.isFrozen(result)).toBe(true);
    expect(read).toHaveBeenCalledWith(connection);
    expect(f.query.mock.calls.map(c=>c[0])).toEqual([expect.stringContaining("external_mcp_identities"),expect.stringContaining("entitlements"),expect.stringContaining("connectwise_connections")]);
    expect(f.query.mock.calls[0][1]).toEqual([principal.issuer,principal.subject]);
    expect(f.query.mock.calls.map(c=>c[0]).join(" ")).not.toMatch(/email|display_name|company_id=|auth_sessions/);
  });
  it("denies DB errors safely and wrong issuer before any lookup",async()=>{
    const f=storeFixture();await expect(f.store.resolve({...principal,issuer:"wrong"})).rejects.toThrow("access_denied");expect(f.query).not.toHaveBeenCalled();
    f.query.mockRejectedValue(new Error("private-token-canary"));await expect(f.store.resolve(principal)).rejects.toThrow("service_unavailable");
  });
  it("reads only the exact stored secret versions, without metadata/list/latest fallback",async()=>{
    const getSecret=vi.fn(async(name:string)=>({value:name.endsWith("public")?config.publicKey:config.privateKey}));
    const reader=customerCredentialReader({getSecret} as never);
    expect(await reader.read(connection)).toEqual({publicKey:config.publicKey,privateKey:config.privateKey});
    expect(getSecret.mock.calls).toEqual([[secretNames(cid).publicKey,expect.objectContaining({version:"a".repeat(32)})],[secretNames(cid).privateKey,expect.objectContaining({version:"b".repeat(32)})]]);
    getSecret.mockClear();await expect(reader.read({...connection,privateRef:refs.privateRef.replace(cid,uid)})).rejects.toThrow("service_unavailable");expect(getSecret).not.toHaveBeenCalled();
    getSecret.mockRejectedValue(new Error(config.privateKey));await expect(reader.read(connection)).rejects.toThrow(/^service_unavailable$/);
  });
});
describe("pinned request-scoped transport",()=>{
  it("is lazy, GET-only, TLS verified, host-bound and rejects redirects",async()=>{
    const resolve=vi.fn(async()=>[{address:"93.184.216.34",family:4}]),send=vi.fn(async(_url:string,_options:unknown)=>new Response("{}"));
    const value=customerTransport(connection.baseUrl,resolve,send as never);
    try {
      expect(resolve).not.toHaveBeenCalled();
      await value.transport(`${connection.baseUrl}/v4_6_release/apis/3.0/company/companies?pageSize=1`,{method:"GET"});
      expect(resolve).toHaveBeenCalledOnce();expect(send.mock.calls[0][1]).toMatchObject({method:"GET",redirect:"error",dispatcher:expect.anything()});
      for(const method of ["POST","PUT","PATCH","DELETE"])await expect(value.transport(`${connection.baseUrl}/v4_6_release/apis/3.0/system/info`,{method})).rejects.toThrow(/^connectwise_transport_failed$/);
      await expect(value.transport("https://other.example.com/v4_6_release/apis/3.0/system/info",{method:"GET"})).rejects.toThrow();
      expect(send).toHaveBeenCalledOnce();
    } finally {await value.close();}
  });
  it("rejects DNS rebinding to private addresses before any CW request",async()=>{
    const send=vi.fn();const value=customerTransport(connection.baseUrl,async()=>[{address:"10.0.0.1",family:4}],send);
    try {await expect(value.transport(`${connection.baseUrl}/v4_6_release/apis/3.0/system/info`,{method:"GET"})).rejects.toThrow();expect(send).not.toHaveBeenCalled();}finally{await value.close();}
  });
});
async function toolSchema(clientOverride?:CwManageClient) {
  const server=createMcpServer(config,auth.requiredScope,clientOverride),client=new Client({name:"schema-test",version:"1"});
  const [left,right]=InMemoryTransport.createLinkedPair();await server.connect(right);await client.connect(left);
  try{return (await client.listTools()).tools;}finally{await client.close();await server.close();}
}
describe("real SDK account-scoped wire contract",()=>{
  it("preserves all 39 names/schemas/security annotations with client injection",async()=>{
    const tools=await toolSchema(new CwManageClient(config,vi.fn()));
    expect(tools).toEqual(await toolSchema());expect(tools.map(t=>t.name).sort()).toEqual([...EXPECTED_READ_TOOLS].sort());
  });
  it("interleaves two signed principals without account/header/tool-argument substitution or leakage",async()=>{
    const logs=vi.spyOn(console,"error").mockImplementation(()=>{}),pair=await generateKeyPair("RS256");
    const sign=(sub:string)=>new SignJWT({scope:auth.requiredScope,email:"private-email-canary"}).setProtectedHeader({alg:"RS256"}).setIssuer(auth.issuer).setAudience(auth.resourceUri).setSubject(sub).setExpirationTime("5m").sign(pair.privateKey);
    const tokens=await Promise.all([sign("customer-a"),sign("customer-b")]);
    const deny=new Set<string>(),read=vi.fn(async(c:typeof connection)=>({publicKey:`public-${c.accountId}`,privateKey:`private-${c.accountId}`}));
    const store={resolve:vi.fn(async(p:typeof principal)=>{
      if(deny.has(p.subject)||!["customer-a","customer-b"].includes(p.subject))throw new CustomerAccessError();
      return {...connection,accountId:p.subject,companyId:p.subject,baseUrl:`https://${p.subject}.example.com`};
    })};
    const requests:{host:string;authorization:string;clientId:string|null}[]=[];
    const handler=createHttpHandler({authConfig:auth,authenticate:createPrincipalAuthenticator(auth,async()=>pair.publicKey),customerConfigProvider:createCustomerConfigProvider(store,{read}),
      customerClientFactory:value=>({client:new CwManageClient(value,(async(url:string|URL|Request,options?:RequestInit)=>{
        const headers=new Headers(options?.headers);requests.push({host:new URL(String(url)).hostname,authorization:headers.get("Authorization")!,clientId:headers.get("clientId")});
        await new Promise(r=>setTimeout(r,value.companyId==="customer-a"?20:1));
        return Response.json({id:1,name:value.companyId});
      }) as typeof fetch),close:async()=>{}})});
    const server=createServer((req,res)=>{void handler(req,res);});await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const url=new URL(`http://127.0.0.1:${(server.address() as {port:number}).port}/mcp`);
    const clients=tokens.map(()=>new Client({name:"isolation-test",version:"1"}));
    try {
      await Promise.all(clients.map((c,i)=>c.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${tokens[i]}`}}}))));
      expect((await clients[0].listTools()).tools).toHaveLength(39);
      const results=await Promise.all(clients.map((c)=>c.callTool({name:"cw_get_company",arguments:{id:1,accountId:"foreign-account",connectionId:"foreign-connection"}})));
      expect(JSON.stringify(results[0])).toContain("customer-a");expect(JSON.stringify(results[0])).not.toContain("customer-b");
      expect(JSON.stringify(results[1])).toContain("customer-b");expect(JSON.stringify(results[1])).not.toContain("customer-a");
      for(const request of requests){
        const customer=request.host.split(".")[0];expect(request.authorization).toBe(`Basic ${Buffer.from(`${customer}+public-${customer}:private-${customer}`).toString("base64")}`);expect(request.clientId).toBe(GLOBAL_CLIENT_ID);
      }
      const readsBefore=read.mock.calls.length,requestsBefore=requests.length;deny.add("customer-a");
      await expect(clients[0].listTools()).rejects.toThrow();expect(read.mock.calls.length).toBe(readsBefore);expect(requests.length).toBe(requestsBefore);
      expect((await clients[1].listTools()).tools).toHaveLength(39);
      const foreign=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${tokens[1]}`,"X-Account-Id":"foreign"}});expect(foreign.status).toBe(400);
      const output=JSON.stringify(logs.mock.calls);for(const secret of [...tokens,"private-email-canary","customer-a","customer-b","public-customer-a","private-customer-b"])expect(output).not.toContain(secret);
    }finally{await Promise.all(clients.map(c=>c.close()));server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  });
});

describe("hosted entrypoint has no pilot fallback",()=>{
  it("fails before binding if the dedicated DB role is missing, even with complete valid pilot configuration",()=>{
    const result=spawnSync(process.execPath,["dist/index.js"],{cwd:process.cwd(),encoding:"utf8",env:{...process.env,NODE_ENV:"production",MCP_TRANSPORT:"http",
      DESCOPE_MCP_ISSUER:auth.issuer,DESCOPE_MCP_JWKS_URI:auth.jwksUri,MCP_RESOURCE_URI:auth.resourceUri,MCP_REQUIRED_SCOPE:auth.requiredScope,
      CW_DB_USER:"cw_control",CW_DB_PASSWORD_SECRET:"cw-control-db-password",CW_MANAGE_URL:config.baseUrl,CW_MANAGE_COMPANY_ID:config.companyId,
      CW_MANAGE_PUBLIC_KEY:config.publicKey,CW_MANAGE_PRIVATE_KEY:config.privateKey,MCP_APPROVED_USER_ID:principal.subject,MCP_APPROVED_USER_CLAIM:"/sub"},timeout:10000});
    expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).not.toMatch(/synthetic-public-secret|synthetic-private-secret|synthetic-subject/);
  });
});

describe("customer-vault reader permission contract",()=>{
  it("contains only exact secret GET DataAction, no administration or metadata enumeration",async()=>{
    const role=JSON.parse(await readFile(new URL("../../deployment/azure/customer-credential-reader-role.json",import.meta.url),"utf8"));
    expect(role.Actions).toEqual([]);expect(role.DataActions).toEqual(["Microsoft.KeyVault/vaults/secrets/getSecret/action"]);
    expect(role.AssignableScopes).toEqual(["/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-connectwise-prod-rg"]);
    expect(role.IsCustom).toBe(true);
  });
});
