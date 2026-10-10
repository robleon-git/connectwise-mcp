import { readFile } from "node:fs/promises";
import { describe, it, expect, vi } from "vitest";
// @ts-expect-error Operator script has no declarations.
import { customerSmoke } from "../../scripts/deploy/customer-smoke.mjs";
// @ts-expect-error Operator script has no declarations.
import { configuration } from "../../scripts/deploy/common.mjs";
import { API_PREFIX, CALLBACK_URI, PORTAL_ORIGIN } from "../control-plane/auth/identity.js";
describe("approved permanent customer-host delivery contract", () => {
  it("pins customer origins and exact callback without changing MCP", async () => {
    const c = await configuration();
    expect(c.portalOrigin).toBe(PORTAL_ORIGIN); expect(c.controlApiPrefix).toBe(API_PREFIX);
    expect(c.controlApiOrigin+c.controlApiPrefix+"/auth/callback").toBe(CALLBACK_URI);
    expect(c.mcpResource).toBe("https://api.monotorr.com/mcp");
    const config = JSON.parse(await readFile(new URL("../../portal/public/staticwebapp.config.json", import.meta.url), "utf8"));
    expect(config.globalHeaders["Content-Security-Policy"]).toContain("connect-src 'self' https://api.monotorr.com;");
    expect(config.routes).toContainEqual({ route: "/.auth/login/aad", statusCode: 404 });
  });
  it("reports only fixed customer smoke facts without following login or printing state/code/cookies", async () => {
    const url = new URL("https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize");
    url.search = new URLSearchParams({ redirect_uri: CALLBACK_URI, client_id: "4405ef16-dc89-4385-8a84-cda2a52274cf", code_challenge_method: "S256", scope: "openid profile email", state: "synthetic-secret-canary" }).toString();
    const transport = vi.fn(async (input: string) => input.endsWith("/auth/login") ? new Response(null,{status:302,headers:{Location:url.href,"Set-Cookie":"synthetic=redacted; HttpOnly"}}) : new Response(null,{status:401,headers:{"Access-Control-Allow-Origin":PORTAL_ORIGIN,"Access-Control-Allow-Credentials":"true"}}));
    const result = await customerSmoke(transport);
    expect(result).toEqual({ customerAnonymousDenied: true, customerCorsMatched: true, microsoftLoginStarted: true });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret"); expect(transport).toHaveBeenCalledTimes(2);
  });
  it("fails if the existing Monotorr fallback handled the proposed customer namespace", async () => {
    await expect(customerSmoke(vi.fn(async () => new Response(null,{status:404})))).rejects.toThrow("customer_smoke_failed");
  });
});

// @ts-expect-error Operator script has no declarations.
import { proposedRouting, matchingTarget } from "../../scripts/deploy/customer-routing.mjs";
describe("additive shared-host namespace routing", () => {
  const before = { customDomains: [{ name: "api.monotorr.com", bindingType: "SniEnabled", certificateId: "existing-nonsecret-certificate-reference" }], rules: [
    { routes: [{ match: { path: "/mcp", caseSensitive: true }, action: {} }, { match: { path: "/.well-known/oauth-protected-resource/mcp", caseSensitive: true }, action: {} }], targets: [{ containerApp: "connectwise-mcp-pilot" }] },
    { routes: [{ match: { prefix: "/", caseSensitive: true }, action: {} }], targets: [{ containerApp: "monotorr-api-prod" }] }
  ] };
  it("preserves MCP, certificate and Monotorr fallback exactly", () => {
    const result = proposedRouting(before);
    expect(result.customDomains).toEqual(before.customDomains); expect(result.rules[0]).toEqual(before.rules[0]); expect(result.rules[2]).toEqual(before.rules[1]);
    expect(before.rules).toHaveLength(2);
    for (const path of ["/mcp","/.well-known/oauth-protected-resource/mcp"]) expect(matchingTarget(path,result)).toBe("connectwise-mcp-pilot");
    for (const path of ["/v1/provider/overview","/health","/connectwise/v10","/connectwise/v1other","/Connectwise/v1"]) expect(matchingTarget(path,result)).toBe("monotorr-api-prod");
    for (const path of ["/connectwise/v1","/connectwise/v1/auth/callback","/connectwise/v1/account/status"]) expect(matchingTarget(path,result)).toBe("connectwise-control-api");
  });
  it("refuses an unexpected existing configuration instead of overwriting it", () => {
    expect(() => proposedRouting({ ...before, rules: before.rules.slice(1) })).toThrow("unexpected_live_routing");
    expect(() => proposedRouting({ ...before, customDomains: [] })).toThrow("unexpected_live_routing");
  });
});
