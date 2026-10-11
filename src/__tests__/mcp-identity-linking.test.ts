import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import * as oauth from "openid-client";
import { generateKeyPair, SignJWT, EncryptJWT } from "jose";
import { linkingProviderFromConfig, MCP_LINK_CALLBACK } from "../control-plane/auth/mcp-link-provider.js";
import { McpLinkStore } from "../control-plane/auth/mcp-link-store.js";
import { mcpLinkRoutes, LINK_COOKIE } from "../control-plane/auth/mcp-link-routes.js";
import { createControlApi } from "../control-plane/server.js";
import { customerRoutes, SESSION_COOKIE } from "../control-plane/auth/routes.js";
import { hashToken } from "../control-plane/auth/store.js";
import { createResourceTokenVerifier } from "../auth/descope-mcp.js";
import { API_PREFIX, PORTAL_ORIGIN } from "../control-plane/auth/identity.js";
const resource={issuer:"https://identity.example/v1/apps/agentic/Ptest/RStest",resourceUri:"https://api.monotorr.com/mcp",jwksUri:"https://identity.example/keys",requiredScope:"connectwise.read"};
const flow={state:"s".repeat(43),verifier:"v".repeat(43)};
afterEach(()=>vi.restoreAllMocks());
async function providerFixture(patch:Record<string,unknown>={}) {
  const pair=await generateKeyPair("RS256");
  const token=await new SignJWT({scope:resource.requiredScope,privateClaim:"private-claim-canary",...patch}).setProtectedHeader({alg:"RS256"})
    .setIssuer(resource.issuer).setAudience(resource.resourceUri).setSubject("synthetic-linked-subject").setExpirationTime("5m").sign(pair.privateKey);
  const config=new oauth.Configuration({issuer:resource.issuer,authorization_endpoint:"https://identity.example/authorize",token_endpoint:"https://identity.example/token",jwks_uri:resource.jwksUri,
    code_challenge_methods_supported:["S256"],response_types_supported:["code"],token_endpoint_auth_methods_supported:["none"]},"synthetic-public-client",undefined,oauth.None());
  const send=vi.fn(async(_input:string|URL,options?:RequestInit)=>{
    const form=new URLSearchParams(String(options?.body));expect(form.get("resource")).toBe(resource.resourceUri);expect(form.get("code_verifier")).toBe(flow.verifier);
    expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    return Response.json({access_token:token,token_type:"Bearer",refresh_token:"private-refresh-canary"});
  });config[oauth.customFetch]=send;
  return {config,token,send,provider:linkingProviderFromConfig(config,resource,createResourceTokenVerifier(resource,async()=>pair.publicKey))};
}
describe("resource-specific OAuth linkage",()=>{
  it("requests code/S256/canonical resource without offline_access and returns only signed stable identity",async()=>{
    const f=await providerFixture();const url=new URL(await f.provider.start(flow));
    expect(url.searchParams.get("redirect_uri")).toBe(MCP_LINK_CALLBACK);expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("resource")).toBe(resource.resourceUri);expect(url.searchParams.get("scope")).toBe("connectwise.read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");expect(url.href).not.toContain(flow.verifier);
    const result=await f.provider.complete(new URL(`${MCP_LINK_CALLBACK}?code=synthetic-code&state=${flow.state}`),flow);
    expect(result).toEqual({issuer:resource.issuer,subject:"synthetic-linked-subject"});expect(f.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/private-claim|private-refresh|eyJ/);
  });
  it("rejects incorrect state before exchange and missing scope after signed resource validation",async()=>{
    const f=await providerFixture();await expect(f.provider.complete(new URL(`${MCP_LINK_CALLBACK}?code=x&state=wrong`),flow)).rejects.toThrow(/^customer_auth_failed$/);expect(f.send).not.toHaveBeenCalled();
    const g=await providerFixture({scope:"foreign"});await expect(g.provider.complete(new URL(`${MCP_LINK_CALLBACK}?code=x&state=${flow.state}`),flow)).rejects.toThrow(/^customer_auth_failed$/);
  });
  it("fails closed on changed issuer/JWKS, missing advertised S256 or unsupported public-client auth",async()=>{
    const f=await providerFixture();for(const change of [{issuer:"https://wrong.example"},{jwks_uri:"https://wrong.example/keys"},{code_challenge_methods_supported:[]},{token_endpoint_auth_methods_supported:["client_secret_basic"]}]) {
      const config=new oauth.Configuration(JSON.parse(JSON.stringify({...f.config.serverMetadata(),...change})),"synthetic-client",undefined,oauth.None());
      expect(()=>linkingProviderFromConfig(config,resource)).toThrow();
    }
  });
});
describe("stable immutable identity persistence",()=>{
  it("binds using issuer/subject and existing owned session, never email",async()=>{
    const query=vi.fn(async(_sql:string,_values?:unknown[])=>({rowCount:1,rows:[{}]})),store=new McpLinkStore({query} as never,resource.issuer),context={userId:"synthetic-user",accountId:"synthetic-account",name:null};
    await store.begin(context,"synthetic-session",flow.state);await store.consume(context,"synthetic-session",flow.state);
    await store.link(context,"synthetic-session",{issuer:resource.issuer,subject:"synthetic-subject"});
    expect(query.mock.calls.map(c=>c[0]).join(" ")).not.toMatch(/email|display_name|UPDATE public.external_mcp/);
    expect(JSON.stringify(query.mock.calls)).toContain(hashToken("synthetic-session"));
    expect(JSON.stringify(query.mock.calls)).not.toContain('"synthetic-session"');
  });
  it("rejects ambiguous/conflicting subject mappings and wrong issuer",async()=>{
    const query=vi.fn(async()=>({rows:[]})),store=new McpLinkStore({query} as never,resource.issuer),context={userId:"synthetic-user",accountId:"synthetic-account",name:null};
    await expect(store.link(context,"session",{issuer:resource.issuer,subject:"already-linked-to-another-user"})).rejects.toThrow();
    query.mockClear();await expect(store.link(context,"session",{issuer:"wrong",subject:"synthetic"})).rejects.toThrow();expect(query).not.toHaveBeenCalled();
  });
});
async function routeFixture() {
  const a={userId:"synthetic-user-a",accountId:"synthetic-account-a",name:null},b={userId:"synthetic-user-b",accountId:"synthetic-account-b",name:null};
  const sessionA="a".repeat(43),sessionB="b".repeat(43);let storedState="",consumed=false,revoked=false;
  const customers={session:vi.fn(async(token?:string)=>revoked?null:token===sessionA?a:token===sessionB?b:null)};
  const links={begin:vi.fn(async(_context:unknown,_session:string,state:string)=>{storedState=state;consumed=false;}),consume:vi.fn(async(context:typeof a,session:string,state:string)=>{
    if(consumed||state!==storedState||session!==sessionA||context.userId!==a.userId)throw new Error();consumed=true;
  }),link:vi.fn(async()=>{}),status:vi.fn(async()=>({linked:false}))};
  const provider={start:vi.fn(async()=>"https://identity.example/authorize"),complete:vi.fn(async()=>({issuer:resource.issuer,subject:"private-subject-canary"}))};
  const router=customerRoutes(customers as never,{start:async()=>"",complete:async()=>{throw new Error();}},new Uint8Array(32),undefined,
    mcpLinkRoutes(customers as never,links as never,provider,new Uint8Array(32)));
  const server=createServer(createControlApi(async()=>true,router).app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}${API_PREFIX}`;
  const start=()=>fetch(base+"/ai/link",{method:"POST",headers:{Origin:PORTAL_ORIGIN,Cookie:`${SESSION_COOKIE}=${sessionA}`}});
  return {a,b,customers,links,provider,base,start,sessionA,sessionB,revoke:()=>{revoked=true;},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}};
}
describe("session-bound single-use linking routes",()=>{
  it("requires exact portal origin/session, returns only authorization URL, and seals a separate HttpOnly flow cookie",async()=>{
    const f=await routeFixture();try {
      const denied=await fetch(f.base+"/ai/link",{method:"POST"});expect(denied.status).toBe(403);expect(f.provider.start).not.toHaveBeenCalled();
      const noSession=await fetch(f.base+"/ai/link",{method:"POST",headers:{Origin:PORTAL_ORIGIN}});expect(noSession.status).toBe(401);
      const response=await f.start();expect(await response.json()).toEqual({authorizationUrl:"https://identity.example/authorize"});
      expect(response.headers.get("set-cookie")).toContain(`${LINK_COOKIE}=`);expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);expect(response.headers.get("set-cookie")).toMatch(/Secure/);
      expect(f.links.begin).toHaveBeenCalledWith(f.a,f.sessionA,expect.any(String));
    }finally{await f.close();}
  });
  it("links once after both ownership proofs; replay and swapped browser identity never exchange another token",async()=>{
    const f=await routeFixture();try {
      const response=await f.start(),cookie=response.headers.get("set-cookie")!.split(";")[0],state=f.links.begin.mock.calls[0][2];
      const url=f.base+`/ai/callback?code=private-code-canary&state=${state}`;
      const wrong=await fetch(url,{redirect:"manual",headers:{Cookie:`${SESSION_COOKIE}=${f.sessionB}; ${cookie}`}});expect(wrong.status).toBe(401);expect(f.provider.complete).not.toHaveBeenCalled();
      const success=await fetch(url,{redirect:"manual",headers:{Cookie:`${SESSION_COOKIE}=${f.sessionA}; ${cookie}`}});expect(success.status).toBe(303);expect(success.headers.get("location")).toBe(PORTAL_ORIGIN+"/");
      expect(f.links.link).toHaveBeenCalledWith(f.a,f.sessionA,{issuer:resource.issuer,subject:"private-subject-canary"});
      const replay=await fetch(url,{redirect:"manual",headers:{Cookie:`${SESSION_COOKIE}=${f.sessionA}; ${cookie}`}});expect(replay.status).toBe(401);expect(f.provider.complete).toHaveBeenCalledOnce();
      expect(await replay.text()).toBe('{"error":"link_failed"}');
    }finally{await f.close();}
  });
  it("revoked session denies callback before exchange and returns only sanitized errors",async()=>{
    const f=await routeFixture();try{
      const response=await f.start(),cookie=response.headers.get("set-cookie")!.split(";")[0],state=f.links.begin.mock.calls[0][2];f.revoke();
      const denied=await fetch(f.base+`/ai/callback?code=private-code-canary&state=${state}`,{headers:{Cookie:`${SESSION_COOKIE}=${f.sessionA}; ${cookie}`}});
      expect(denied.status).toBe(401);expect(await denied.text()).toBe('{"error":"link_failed"}');expect(f.links.consume).not.toHaveBeenCalled();expect(f.provider.complete).not.toHaveBeenCalled();
    }finally{await f.close();}
  });
  it.each(["tampered","expired","wrong-purpose"])("rejects %s encrypted flow before exchange",async kind=>{
    const f=await routeFixture();try {
      await f.start();const state=f.links.begin.mock.calls[0][2];
      const sealed=kind==="tampered"?"invalid-sealed-value":await new EncryptJWT({state,verifier:flow.verifier,sessionHash:hashToken(f.sessionA)})
        .setProtectedHeader({alg:"dir",enc:"A256GCM"}).setIssuer("https://api.monotorr.com").setAudience(kind==="wrong-purpose"?"cw-browser-flow":"cw-mcp-link-flow")
        .setExpirationTime(kind==="expired"?1:"5m").encrypt(new Uint8Array(32));
      const response=await fetch(f.base+`/ai/callback?code=private-code-canary&state=${state}`,{headers:{Cookie:`${SESSION_COOKIE}=${f.sessionA}; ${LINK_COOKIE}=${sealed}`}});
      expect(response.status).toBe(401);expect(await response.text()).toBe('{"error":"link_failed"}');expect(f.provider.complete).not.toHaveBeenCalled();expect(f.links.consume).not.toHaveBeenCalled();
    }finally{await f.close();}
  });

});
