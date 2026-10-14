import { Router, json, type Router as RouterType } from "express";
import { ConnectionError } from "../../connections/errors.js";
import type { ConnectionService } from "../../connections/service.js";
import { randomBytes } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import { API_ORIGIN, API_PREFIX, CALLBACK_URI, PORTAL_ORIGIN, CustomerAuthError } from "./identity.js";
import { FLOW_SECONDS, SESSION_SECONDS, type CustomerStore } from "./store.js";
import type { IdentityProvider, BrowserFlow } from "./microsoft.js";
export const SESSION_COOKIE = "__Secure-cw-customer-session";
export const FLOW_COOKIE = "__Secure-cw-browser-flow";
export const sessionCookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: API_PREFIX };
const flowCookieOptions = { ...sessionCookieOptions, path: `${API_PREFIX}/auth` };
export function readCookie(header: string | undefined, name: string) {
  const found = (header || "").split(";").map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  if (found.length !== 1) return undefined;
  return found[0].slice(name.length + 1);
}
export function customerRoutes(store: CustomerStore, provider: IdentityProvider, flowKey: Uint8Array, connections?: {service:Pick<ConnectionService,"setup"|"status">;enabled:boolean}, ai?: RouterType, billing?: RouterType) {
  if (flowKey.length !== 32) throw new CustomerAuthError();
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.get("Origin");
    res.vary("Origin");
    if (origin === PORTAL_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", PORTAL_ORIGIN);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (origin && origin !== PORTAL_ORIGIN) { res.status(403).json({ error: "forbidden" }); return; }
    if (req.method === "OPTIONS") { res.sendStatus(origin === PORTAL_ORIGIN ? 204 : 403); return; }
    if (req.method === "POST" && origin !== PORTAL_ORIGIN) { res.status(403).json({ error: "forbidden" }); return; }
    next();
  });
  if (ai) router.use(ai);
  if (billing) router.use(billing);
  router.get("/auth/login", async (_req, res) => {
    try {
      const random = () => randomBytes(32).toString("base64url");
      const flow: BrowserFlow = { state: random(), nonce: random(), verifier: random() };
      const url = await provider.start(flow);
      await store.beginFlow(flow.state);
      const sealed = await new EncryptJWT({ ...flow }).setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setIssuer(API_ORIGIN).setAudience("cw-browser-flow").setIssuedAt().setExpirationTime(`${FLOW_SECONDS}s`).encrypt(flowKey);
      res.cookie(FLOW_COOKIE, sealed, { ...flowCookieOptions, maxAge: FLOW_SECONDS * 1000 });
      res.redirect(302, url);
    } catch { res.status(503).json({ error: "login_unavailable" }); }
  });
  router.get("/auth/callback", async (req, res) => {
    res.clearCookie(FLOW_COOKIE, flowCookieOptions);
    try {
      const sealed = readCookie(req.get("Cookie"), FLOW_COOKIE);
      if (!sealed || sealed.length > 4096) throw new CustomerAuthError();
      const { payload } = await jwtDecrypt(sealed, flowKey, { issuer: API_ORIGIN, audience: "cw-browser-flow", keyManagementAlgorithms: ["dir"], contentEncryptionAlgorithms: ["A256GCM"] });
      const { state, nonce, verifier } = payload;
      if ([state, nonce, verifier].some(value => typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value as string))) throw new CustomerAuthError();
      const url = new URL(req.originalUrl, API_ORIGIN);
      if (url.origin !== API_ORIGIN || url.pathname !== new URL(CALLBACK_URI).pathname ||
          url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== state ||
          url.searchParams.getAll("code").length !== 1 || !url.searchParams.get("code") || url.searchParams.has("error")) throw new CustomerAuthError();
      await store.consumeFlow(state as string);
      const identity = await provider.complete(url, { state, nonce, verifier } as BrowserFlow);
      const session = await store.login(identity);
      res.cookie(SESSION_COOKIE, session.token, { ...sessionCookieOptions, maxAge: SESSION_SECONDS * 1000 });
      res.redirect(303, PORTAL_ORIGIN + "/");
    } catch { res.status(401).json({ error: "login_failed" }); }
  });
  router.post("/auth/logout", async (req, res) => {
    try {
      await store.logout(readCookie(req.get("Cookie"), SESSION_COOKIE));
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions);
      res.status(204).end();
    } catch { res.status(503).json({ error: "unavailable" }); }
  });
  router.post("/connectwise/connection", async (req,res) => {
    try {
      if(!connections?.enabled) {res.status(404).json({error:"not_available"});return;}
      if(Object.keys(req.query).length || req.get("X-Account-Id")) {res.status(400).json({error:"invalid_request"});return;}
      const context=await store.session(readCookie(req.get("Cookie"),SESSION_COOKIE));
      if(!context){res.status(401).json({error:"unauthorized"});return;}
      // Parse submitted keys only after authentication; reject compressed/oversized bodies.
      json({limit:"8kb",inflate:false,strict:true})(req,res,error=>{
        if(error){res.status(400).json({error:"invalid_input"});return;}
        void connections.service.setup(context,req.body).then(result=>res.status(201).json({connectwise:result})).catch(error=>{
          if(error instanceof ConnectionError)res.status(error.httpStatus).json({error:error.code});else res.status(503).json({error:"unavailable"});
        }).finally(()=>{req.body=undefined;});
      });
    } catch {res.status(503).json({error:"unavailable"});}
  });
  for (const path of ["/session", "/account/status"]) router.get(path, async (req, res) => {
    try {
      // Foreign account IDs are not accepted, even if ignored by the SQL query.
      if (Object.keys(req.query).length || req.get("X-Account-Id")) { res.status(400).json({ error: "invalid_request" }); return; }
      const context = await store.session(readCookie(req.get("Cookie"), SESSION_COOKIE));
      if (!context) { res.status(401).json({ error: "unauthorized" }); return; }
      if(path==="/session"){res.json({authenticated:true,account:{id:context.accountId,name:context.name}});return;}
      const status=await store.status(context);
      const connection=connections ? await connections.service.status(context) : status.connectwise;
      res.json({...status,connectwise:{...connection,setupAvailable:!!connections?.enabled&&status.entitlement.allowed},
        nextAction:!status.entitlement.allowed?"access_inactive":connection.status==="connected"?"connect_ai_client":"connect_connectwise"});
    } catch { res.status(503).json({ error: "unavailable" }); }
  });
  return router;
}
