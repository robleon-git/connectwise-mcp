import { Router } from "express";
import { randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { API_ORIGIN, API_PREFIX, PORTAL_ORIGIN, CustomerAuthError } from "./identity.js";
import { hashToken, FLOW_SECONDS, type CustomerStore } from "./store.js";
import { readCookie, SESSION_COOKIE, sessionCookieOptions } from "./routes.js";
import { MCP_LINK_CALLBACK, type McpLinkFlow, type McpLinkProvider } from "./mcp-link-provider.js";
import type { McpLinkStore } from "./mcp-link-store.js";
export const LINK_COOKIE = "__Secure-cw-mcp-link-flow";
const options = {...sessionCookieOptions,path:`${API_PREFIX}/ai`};
export function mcpLinkRoutes(customers: CustomerStore, links: McpLinkStore, provider: McpLinkProvider, flowKey: Uint8Array) {
  if (flowKey.length !== 32) throw new CustomerAuthError();
  const router = Router();
  router.get("/ai/status",async(req,res)=>{
    try {
      if (Object.keys(req.query).length || req.get("X-Account-Id")) throw new CustomerAuthError();
      const context = await customers.session(readCookie(req.get("Cookie"),SESSION_COOKIE));
      if (!context) {res.status(401).json({error:"unauthorized"});return;}
      res.json(await links.status(context));
    } catch {res.status(503).json({error:"unavailable"});}
  });
  router.post("/ai/link",async(req,res)=>{
    try {
      // Defense in depth: parent router also enforces exact portal Origin for every POST.
      if (req.get("Origin") !== PORTAL_ORIGIN || Object.keys(req.query).length || req.get("X-Account-Id")) {res.status(403).json({error:"forbidden"});return;}
      const session = readCookie(req.get("Cookie"),SESSION_COOKIE);
      const context = await customers.session(session);
      if (!context || !session) {res.status(401).json({error:"unauthorized"});return;}
      const flow = {state:randomBytes(32).toString("base64url"),verifier:randomBytes(32).toString("base64url")};
      const authorizationUrl = await provider.start(flow);
      await links.begin(context,session,flow.state);
      const sealed = await new EncryptJWT({...flow,sessionHash:hashToken(session)}).setProtectedHeader({alg:"dir",enc:"A256GCM"})
        .setIssuer(API_ORIGIN).setAudience("cw-mcp-link-flow").setIssuedAt().setExpirationTime(`${FLOW_SECONDS}s`).encrypt(flowKey);
      res.cookie(LINK_COOKIE,sealed,{...options,maxAge:FLOW_SECONDS*1000});
      res.json({authorizationUrl});
    } catch {res.status(503).json({error:"link_unavailable"});}
  });
  router.get("/ai/callback",async(req,res)=>{
    res.clearCookie(LINK_COOKIE,options);
    try {
      const session = readCookie(req.get("Cookie"),SESSION_COOKIE), sealed = readCookie(req.get("Cookie"),LINK_COOKIE);
      const context = await customers.session(session);
      if (!context || !session || !sealed || sealed.length > 4096) throw new CustomerAuthError();
      const {payload} = await jwtDecrypt(sealed,flowKey,{issuer:API_ORIGIN,audience:"cw-mcp-link-flow",keyManagementAlgorithms:["dir"],contentEncryptionAlgorithms:["A256GCM"]});
      const {state,verifier,sessionHash} = payload;
      if (sessionHash !== hashToken(session) || [state,verifier].some(v=>typeof v!=="string" || !/^[A-Za-z0-9_-]{43}$/.test(v as string))) throw new CustomerAuthError();
      const url = new URL(req.originalUrl,API_ORIGIN);
      if (url.pathname !== new URL(MCP_LINK_CALLBACK).pathname || url.searchParams.getAll("state").length!==1 || url.searchParams.get("state")!==state ||
          url.searchParams.getAll("code").length!==1 || !url.searchParams.get("code") || url.searchParams.has("error")) throw new CustomerAuthError();
      await links.consume(context,session,state as string); // Burn before token exchange, including failed/conflicting links.
      const principal = await provider.complete(url,{state,verifier} as McpLinkFlow);
      await links.link(context,session,principal);
      res.redirect(303,`${PORTAL_ORIGIN}/`);
    } catch {res.status(401).json({error:"link_failed"});}
  });
  return router;
}
