import {describe,it,expect,vi} from "vitest";
import {createServer} from "node:http";
import {createControlApi} from "../control-plane/server.js";
import {customerRoutes,SESSION_COOKIE} from "../control-plane/auth/routes.js";
import type {CustomerStore} from "../control-plane/auth/store.js";
import type {IdentityProvider} from "../control-plane/auth/microsoft.js";
import type {ConnectionService} from "../connections/service.js";
import {ConnectionError} from "../connections/errors.js";
import {PORTAL_ORIGIN,API_PREFIX} from "../control-plane/auth/identity.js";
import {createElement} from "react";
import {renderToString} from "react-dom/server";
const portalModule = "../../portal/src/ConnectionForm.tsx";
const {ConnectionForm,saveConnection} = await import(portalModule);
const fields={url:"https://manage.example.com",companyId:"synthetic-company",publicKey:"synthetic-public",privateKey:"synthetic-private"};
async function fixture(enabled=true){
 const a={userId:"user-a",accountId:"account-a",name:null},b={userId:"user-b",accountId:"account-b",name:null};
 const store={session:vi.fn(async(token:string)=>token==="a".repeat(43)?a:token==="b".repeat(43)?b:null),status:vi.fn(async()=>({entitlement:{allowed:true},connectwise:{status:"not_configured"}}))};
 const service={setup:vi.fn(async(_context:typeof a,_input:unknown)=>({status:"connected"})),status:vi.fn(async(context:typeof a)=>context.accountId==='account-a'?{status:"connected",host:"manage.example.com",companyId:"synthetic-company"}:{status:"not_configured"})};
 const {app}=createControlApi(async()=>true,customerRoutes(store as unknown as CustomerStore,{} as IdentityProvider,new Uint8Array(32),{enabled,service:service as unknown as ConnectionService}));
 const server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const port=(server.address() as {port:number}).port;
 return{store,service,a,url:`http://127.0.0.1:${port}${API_PREFIX}`,headers:{Origin:PORTAL_ORIGIN,Cookie:`${SESSION_COOKIE}=${"a".repeat(43)}`,"Content-Type":"application/json"},close:()=>new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();})};
}
describe("scoped setup HTTP boundary",()=>{
 it("requires valid session, exact origin and enabled feature before setup",async()=>{const f=await fixture();try{
  expect((await fetch(f.url+'/connectwise/connection',{method:'POST',headers:{Origin:PORTAL_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(fields)})).status).toBe(401);
  expect((await fetch(f.url+'/connectwise/connection',{method:'POST',headers:{...f.headers,Origin:'https://evil.example'},body:JSON.stringify(fields)})).status).toBe(403);expect(f.service.setup).not.toHaveBeenCalled();
 }finally{await f.close();}const gated=await fixture(false);try{expect((await fetch(gated.url+'/connectwise/connection',{method:'POST',headers:gated.headers,body:JSON.stringify(fields)})).status).toBe(404);expect(gated.service.setup).not.toHaveBeenCalled();}finally{await gated.close();}});
 it("derives account server-side and never returns keys or references",async()=>{const f=await fixture();try{const r=await fetch(f.url+'/connectwise/connection',{method:'POST',headers:f.headers,body:JSON.stringify(fields)});expect(r.status).toBe(201);expect(await r.json()).toEqual({connectwise:{status:'connected'}});expect(f.service.setup.mock.calls[0][0]).toEqual(f.a);}finally{await f.close();}});
 it("rejects foreign selection and bounded malformed bodies",async()=>{const f=await fixture();try{
  for(const options of [{url:'?accountId=foreign',body:JSON.stringify(fields),headers:f.headers},{url:'',body:JSON.stringify(fields),headers:{...f.headers,'X-Account-Id':'foreign'}},{url:'',body:'invalid json',headers:f.headers},{url:'',body:JSON.stringify({...fields,privateKey:'x'.repeat(9000)}),headers:f.headers}])expect((await fetch(f.url+'/connectwise/connection'+options.url,{method:'POST',headers:options.headers,body:options.body})).status).toBe(400);
  expect(f.service.setup).not.toHaveBeenCalled();
 }finally{await f.close();}});
 it("returns only fixed error categories and scopes account status",async()=>{const f=await fixture();try{
  f.service.setup.mockRejectedValueOnce(new ConnectionError('authentication_failed'));let r=await fetch(f.url+'/connectwise/connection',{method:'POST',headers:f.headers,body:JSON.stringify(fields)});expect(await r.text()).toBe('{"error":"authentication_failed"}');
  f.service.setup.mockRejectedValueOnce(new Error(fields.privateKey));r=await fetch(f.url+'/connectwise/connection',{method:'POST',headers:f.headers,body:JSON.stringify(fields)});expect(await r.text()).toBe('{"error":"unavailable"}');
  const a=await(await fetch(f.url+'/account/status',{headers:f.headers})).json() as {connectwise:{status:string}};const b=await(await fetch(f.url+'/account/status',{headers:{...f.headers,Cookie:`${SESSION_COOKIE}=${"b".repeat(43)}`}})).json() as {connectwise:{status:string}};expect(a.connectwise.status).toBe('connected');expect(b.connectwise.status).toBe('not_configured');expect(JSON.stringify(b)).not.toContain('manage.example.com');
 }finally{await f.close();}});
});
describe("minimal setup portal",()=>{
 it("renders four fields, password inputs and no customer Client ID",()=>{const html=renderToString(createElement(ConnectionForm,{onConnected:()=>{}}));expect(html.match(/<input/g)).toHaveLength(4);expect(html.match(/type="password"/g)).toHaveLength(2);expect(html).not.toMatch(/name="clientId"|synthetic-public|synthetic-private/);});
 it("sends only submitted fields and ignores successful response content",async()=>{const send=vi.fn(async(_url:string|URL|Request,_options?:RequestInit)=>new Response(fields.privateKey,{status:201}));expect(await saveConnection(fields,send)).toEqual({connected:true,error:null});expect(send.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'include',redirect:'error'});});
 it("does not reflect arbitrary backend error bodies or credentials",async()=>{const send=vi.fn(async()=>Response.json({error:fields.privateKey},{status:503}));const result=await saveConnection(fields,send);expect(result.connected).toBe(false);expect(JSON.stringify(result)).not.toContain(fields.privateKey);});
});
