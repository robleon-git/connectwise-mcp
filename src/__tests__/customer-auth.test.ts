import { describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import * as oidc from "openid-client";
import { organizationalIdentity, API_ORIGIN, API_PREFIX, CALLBACK_URI, PORTAL_ORIGIN } from "../control-plane/auth/identity.js";
import { evaluateTrial, hashToken, CustomerStore } from "../control-plane/auth/store.js";
import { customerRoutes, readCookie, SESSION_COOKIE, FLOW_COOKIE, sessionCookieOptions } from "../control-plane/auth/routes.js";
import { providerFromConfig, type BrowserFlow, type IdentityProvider } from "../control-plane/auth/microsoft.js";
import { createControlApi } from "../control-plane/server.js";
const tid = "11111111-1111-4111-8111-111111111111", oid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const claims = { tid, oid, iss: `https://login.microsoftonline.com/${tid}/v2.0`, ver: "2.0", email: "synthetic@example.invalid" };
const flow = { state: "s".repeat(43), nonce: "n".repeat(43), verifier: "v".repeat(43) };
describe("organizational identity and trial", () => {
  it("uses immutable tenant/object mapping independent of profile email", () => {
    expect(organizationalIdentity(claims)).toMatchObject({ tenantId: tid, objectId: oid });
    expect(organizationalIdentity({ ...claims, email: "changed@example.invalid" }).objectId).toBe(oid);
    expect(organizationalIdentity({ ...claims, email: "rob@monotorr.com" })).not.toHaveProperty("admin");
  });
  it.each([{ tid: "bad" }, { oid: undefined }, { iss: `${claims.iss}/evil` }, { iss: "https://evil.example" },
    { ver: "1.0" }, { idtyp: "app" }, { idp: "live.com" }, { tid: "9188040d-6c67-4c5b-b112-36a304b66dad" }])("rejects invalid business identity %j", patch => {
    expect(() => organizationalIdentity({ ...claims, ...patch })).toThrow("customer_auth_failed");
  });
  it.each([
    ["2026-01-01T00:00:00Z", true], ["2026-01-30T23:59:59Z", true], ["2026-01-31T00:00:00Z", false], ["2025-12-31T23:59:59Z", false],
  ])("evaluates UTC trial boundaries server-side at %s", (time, allowed) => {
    expect(evaluateTrial({ source: "trial", status: "active", startsAt: new Date("2026-01-01T00:00:00Z"), endsAt: new Date("2026-01-31T00:00:00Z") }, new Date(time)).allowed).toBe(allowed);
  });
  it("denies missing/suspended entitlement independently of identity", () => {
    expect(evaluateTrial(null).allowed).toBe(false);
    expect(evaluateTrial({ source: "trial", status: "suspended", startsAt: new Date(0), endsAt: new Date(Date.now()+10000) }).allowed).toBe(false);
  });
});
describe("maintained OIDC code/PKCE and signed identity validation", () => {
  async function fixture(patch: Record<string, unknown> = {}, badSignature = false, keyIssuer = claims.iss) {
    const pair = await generateKeyPair("RS256");
    const other = badSignature ? await generateKeyPair("RS256") : pair;
    const key = { ...await exportJWK(pair.publicKey), kid: "synthetic-kid", alg: "RS256", use: "sig", issuer: keyIssuer };
    const idToken = await new SignJWT({ ...claims, nonce: flow.nonce, sub: "synthetic-subject", ...patch }).setProtectedHeader({ alg: "RS256", kid: key.kid })
      .setAudience(typeof patch.aud === "string" ? patch.aud : "synthetic-client").setIssuedAt().setExpirationTime(typeof patch.exp === "number" ? patch.exp : "5m").sign(other.privateKey);
    const config = new oidc.Configuration({ issuer: claims.iss, authorization_endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize",
      token_endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/token", jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys" },
      "synthetic-client", { client_secret: "synthetic-secret", id_token_signed_response_alg: "RS256" });
    const transport = vi.fn(async (input: string | URL, options?: RequestInit) => {
      if (String(input).includes("/keys")) return Response.json({ keys: [key] });
      expect(new URLSearchParams(String(options?.body)).get("code_verifier")).toBe(flow.verifier);
      return Response.json({ access_token: "synthetic-access-token", token_type: "Bearer", id_token: idToken });
    });
    config[oidc.customFetch] = transport;
    oidc.enableNonRepudiationChecks(config);
    return { provider: providerFromConfig(config), transport };
  }
  const callback = () => new URL(`${CALLBACK_URI}?state=${flow.state}&code=synthetic-code`);
  it("uses authorization code + PKCE S256, exact redirect and OIDC-only scopes", async () => {
    const { provider } = await fixture();
    const url = new URL(await provider.start(flow));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await oidc.calculatePKCECodeChallenge(flow.verifier));
    expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.href).not.toContain(flow.verifier);
  });
  it("verifies signed token before returning only the stable identity/profile", async () => {
    const { provider } = await fixture();
    const identity = await provider.complete(callback(), flow);
    expect(identity).toEqual({ tenantId: tid, objectId: oid, email: claims.email, name: undefined });
    expect(JSON.stringify(identity)).not.toMatch(/synthetic-access-token|eyJ|synthetic-secret/);
  });
  it.each([{ aud: "foreign-client" }, { exp: 1 }, { nbf: Math.floor(Date.now()/1000)+3600 }, { nonce: "wrong" }, { iss: "https://evil.example" }, { tid: "bad" }, { oid: undefined }])("rejects bad signed claims %j", async patch => {
    const { provider } = await fixture(patch);
    await expect(provider.complete(callback(), flow)).rejects.toThrow(/^customer_auth_failed$/);
  });
  it("rejects invalid signature and key-issuer substitution", async () => {
    await expect((await fixture({}, true)).provider.complete(callback(), flow)).rejects.toThrow(/^customer_auth_failed$/);
    await expect((await fixture({}, false, "https://evil.example")).provider.complete(callback(), flow)).rejects.toThrow(/^customer_auth_failed$/);
  });
  it("rejects callback state substitution without exposing protocol errors", async () => {
    const { provider } = await fixture(); const url = callback(); url.searchParams.set("state", "foreign");
    await expect(provider.complete(url, flow)).rejects.toThrow(/^customer_auth_failed$/);
  });
});
describe("customer API cookies, callback and isolation boundary", () => {
  async function server() {
    const context = { userId: "synthetic-user", accountId: "synthetic-account", name: "Synthetic" };
    const store = { beginFlow: vi.fn(async () => {}), consumeFlow: vi.fn(async () => {}), login: vi.fn(async () => ({ token: "t".repeat(43), context })),
      session: vi.fn(async (token: string | undefined) => token === "t".repeat(43) ? context : null), logout: vi.fn(async () => {}), status: vi.fn(async () => ({ account: { id: context.accountId }, entitlement: { source: "trial", allowed: true }, connectwise: { status: "not_configured" } })) };
    let observed: BrowserFlow | undefined;
    const provider: IdentityProvider = { start: vi.fn(async f => { observed = f; return "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize"; }),
      complete: vi.fn(async () => organizationalIdentity(claims)) };
    const { app } = createControlApi(async () => true, customerRoutes(store as unknown as CustomerStore, provider, new Uint8Array(32).fill(1)));
    const s = createServer(app); await new Promise<void>(resolve => s.listen(0, "127.0.0.1", resolve));
    const address = s.address(); if (!address || typeof address === "string") throw new Error();
    return { url: `http://127.0.0.1:${address.port}`, store, provider, observed: () => observed,
      close: () => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); }) };
  }
  it("uses secure host-only scoped cookies and no bearer/session tokens in response bodies", async () => {
    const s = await server();
    try {
      const begin = await fetch(s.url + API_PREFIX + "/auth/login", { redirect: "manual" });
      expect(begin.status).toBe(302); const cookie = begin.headers.get("set-cookie")!;
      for (const flag of ["HttpOnly", "Secure", "SameSite=Lax", `Path=${API_PREFIX}/auth`]) expect(cookie).toContain(flag);
      expect(cookie).not.toContain("Domain="); expect(cookie).not.toContain(s.observed()!.verifier);
      const callback = await fetch(s.url + API_PREFIX + `/auth/callback?state=${s.observed()!.state}&code=synthetic-code`, { redirect: "manual", headers: { Cookie: cookie.split(";",1)[0] } });
      expect(callback.status).toBe(303); expect(callback.headers.get("location")).toBe(PORTAL_ORIGIN + "/");
      expect(callback.headers.get("set-cookie")).toContain(SESSION_COOKIE);
      expect(callback.headers.get("set-cookie")).not.toContain("Domain=");
      expect(await callback.text()).not.toContain("t".repeat(43));
      expect(s.store.consumeFlow).toHaveBeenCalledOnce(); expect(s.store.login).toHaveBeenCalledOnce();
    } finally { await s.close(); }
  });
  it("rejects malformed/foreign state and never creates an account", async () => {
    const s = await server();
    try {
      const begin = await fetch(s.url + API_PREFIX + "/auth/login", { redirect: "manual" });
      const cookie = begin.headers.get("set-cookie")!.split(";",1)[0];
      for (const query of ["state=foreign&code=x", `state=${s.observed()!.state}&code=x&code=y`, `state=${s.observed()!.state}&error=denied`]) {
        const r = await fetch(s.url + API_PREFIX + "/auth/callback?" + query, { headers: { Cookie: cookie }, redirect: "manual" });
        expect(r.status).toBe(401); expect(await r.text()).toBe('{"error":"login_failed"}');
      }
      expect(s.provider.complete).not.toHaveBeenCalled(); expect(s.store.login).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it("rejects replay, invalid session, foreign IDs and admin routes", async () => {
    const s = await server();
    try {
      expect((await fetch(s.url + API_PREFIX + "/account/status")).status).toBe(401);
      const headers = { Cookie: `${SESSION_COOKIE}=${"t".repeat(43)}`, Origin: PORTAL_ORIGIN };
      const status = await fetch(s.url + API_PREFIX + "/account/status", { headers });
      expect(status.status).toBe(200); expect(status.headers.get("access-control-allow-origin")).toBe(PORTAL_ORIGIN);
      expect(status.headers.get("access-control-allow-credentials")).toBe("true");
      expect((await fetch(s.url + API_PREFIX + "/account/status?accountId=foreign", { headers })).status).toBe(400);
      expect((await fetch(s.url + API_PREFIX + "/account/status", { headers: { ...headers, "X-Account-Id": "foreign" } })).status).toBe(400);
      expect((await fetch(s.url + API_PREFIX + "/admin", { headers })).status).toBe(404);
      expect((await fetch(s.url + API_PREFIX + "/auth/logout", { method: "POST", headers: { Cookie: headers.Cookie, Origin: "https://app.monotorr.com" } })).status).toBe(403);
      expect((await fetch(s.url + API_PREFIX + "/auth/logout", { method: "POST", headers })).status).toBe(204);
      expect(s.store.logout).toHaveBeenCalledWith("t".repeat(43));
      expect((await fetch(s.url + API_PREFIX + "/auth/logout", { method: "POST" })).status).toBe(403);
      const begin = await fetch(s.url + API_PREFIX + "/auth/login", { redirect: "manual" });
      s.store.consumeFlow.mockRejectedValueOnce(new Error("synthetic-secret-canary"));
      const callback = await fetch(s.url + API_PREFIX + `/auth/callback?state=${s.observed()!.state}&code=x`, { redirect: "manual", headers: { Cookie: begin.headers.get("set-cookie")!.split(";",1)[0] } });
      expect(callback.status).toBe(401); expect(await callback.text()).not.toContain("synthetic-secret-canary");
      expect(s.store.login).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it("cannot confuse duplicate cookies and stores only a SHA-256 session hash", () => {
    expect(readCookie(`${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`, SESSION_COOKIE)).toBeUndefined();
    expect(readCookie(`${FLOW_COOKIE}=c`, SESSION_COOKIE)).toBeUndefined();
    expect(hashToken("synthetic-opaque-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(sessionCookieOptions).toEqual({ httpOnly: true, secure: true, sameSite: "lax", path: API_PREFIX });
    expect(API_ORIGIN).toBe("https://api.monotorr.com");
  });
});
