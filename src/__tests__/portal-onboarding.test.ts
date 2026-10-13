import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const mainPath = "../../portal/src/main.tsx";
const aiPath = "../../portal/src/AiSetup.tsx";
const instructionsPath = "../../portal/src/AiClientInstructions.tsx";
const { PortalContent } = await import(mainPath);
const { AiSetupContent, requestAiAuthorization } = await import(aiPath);
const { AiClientInstructions, copyMcpAddress } = await import(instructionsPath);
const noop = () => {};
interface TestStatus { account: { id: string; name: string }; entitlement: { allowed: boolean; source: string | null; status: string; expiresAt: string }; connectwise: { status: string; setupAvailable: boolean; host?: string; companyId?: string } }
const status: TestStatus = { account: { id: "not-visible", name: "Example MSP" }, entitlement: { allowed: true, source: "trial", status: "active", expiresAt: "2026-12-01T00:00:00Z" }, connectwise: { status: "not_configured", setupAvailable: true } };
function portal(value = status, extras: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(PortalContent, { status: value, loading: false, error: false, setup: false, onRetry: noop, onSetup: noop, onConnected: noop, onLogout: noop, ...extras }));
}
function ai(extras: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(AiSetupContent, { linked: false, failed: false, busy: false, unavailable: false, onRetry: noop, onConnect: noop, ...extras }));
}
describe("portal onboarding", () => {
  it("prioritizes ConnectWise before AI and keeps three ordered sections", () => {
    const html = portal();
    expect(html).toContain(">Connect ConnectWise</button>");
    expect(html).toContain("Connect ConnectWise first.");
    expect(html).not.toContain(">Connect your AI</button>");
    expect(html.indexOf('id="connectwise-heading"')).toBeLessThan(html.indexOf('id="ai-heading"'));
    expect(html.indexOf('id="ai-heading"')).toBeLessThan(html.indexOf('id="account-heading"'));
  });
  it("shows saved connection metadata without inventing a live health check or manage controls", () => {
    const html = portal({ ...status, connectwise: { ...status.connectwise, status: "connected", host: "cw.example.com", companyId: "example" } });
    expect(html).toContain("Connected"); expect(html).toContain("cw.example.com");
    expect(html).toContain("not a live connection check");
    expect(html).not.toMatch(/Manage connection|Disconnect|Test Connection/);
    expect(html).toContain("Checking your AI setup");
  });
  it("prioritizes expired access without onboarding requests or actions", () => {
    const html = portal({ ...status, entitlement: { ...status.entitlement, allowed: false, status: "expired" } });
    expect(html.indexOf("Your access has expired")).toBeLessThan(html.indexOf('id="connectwise-heading"'));
    expect(html).toContain("Access expired");
    expect(html).not.toMatch(/Connect ConnectWise<\/button>|Connect your AI<\/button>|Checking your AI|Open ChatGPT/);
  });
  it("fails closed for inactive access and unavailable setup", () => {
    expect(portal({ ...status, entitlement: { ...status.entitlement, allowed: false, source: null, status: "absent" } })).toContain("Access not active");
    expect(portal({ ...status, connectwise: { ...status.connectwise, setupAvailable: false } })).toContain("Connection setup is temporarily unavailable");
  });
  it("offers Microsoft sign-in when logged out, with no native portal sign-in", () => {
    const html = portal(status, { status: null });
    expect(html).toContain("/auth/login"); expect(html).toContain("Sign in with Microsoft");
    expect(html).not.toMatch(/email-code|Connect your AI|API Key/);
  });
  it("renders loading and recoverable account errors without stale actionable status", () => {
    expect(portal(status, { loading: true })).toContain('role="status"');
    const html = portal(status, { error: true });
    expect(html).toContain('role="alert"'); expect(html).toContain("Try again"); expect(html).not.toContain("Example MSP");
  });
  it("labels association as readiness rather than external connectivity", () => {
    const html = ai({ linked: true });
    expect(html).toContain("Ready to connect"); expect(html).toContain("Finish setup in your assistant");
    expect(html).not.toContain("ChatGPT Connected");
  });
  it("provides sanitized AI loading, failure, disabled-server and busy states", () => {
    expect(ai({ linked: null })).toContain("Checking your AI setup");
    expect(ai({ failed: true })).toContain("Try again");
    expect(ai({ unavailable: true })).not.toContain(">Connect your AI</button>");
    expect(ai({ busy: true })).toContain('disabled=""');
    expect(ai({ busy: true })).toContain("Opening sign-in");
  });
  it("renders the exact MCP address, documented destination and compact client instructions", () => {
    const html = renderToStaticMarkup(createElement(AiClientInstructions));
    expect(html).toContain("https://api.monotorr.com/mcp"); expect(html).toContain('href="https://chatgpt.com/plugins"');
    for (const text of ["Copy address", "Open ChatGPT", "Claude", "Copilot Studio", "Other MCP-compatible clients", "same email-code sign-in", "OAuth", "Reconnect in ChatGPT"]) expect(html).toContain(text);
  });
  it("does not expose implementation terminology in any supported display state", () => {
    for (const html of [portal(), portal(status, { setup: true }), ai(), ai({ linked: true }), ai({ failed: true })])
      expect(html).not.toMatch(/MCP identity|Link AI identity|Linked identity|issuer|subject|Descope|SAML|Entitlement status|Access source|Client ID|not-visible/);
  });
  it("copies only the public endpoint and handles denied/unavailable clipboard access", async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyMcpAddress({ writeText })).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("https://api.monotorr.com/mcp");
    expect(await copyMcpAddress(undefined)).toBe(false);
    expect(await copyMcpAddress({ writeText: async () => { throw new Error("private-error"); } })).toBe(false);
  });
  it("preserves credentialed POST, exact linking endpoint and HTTPS navigation", async () => {
    const send = vi.fn(async () => Response.json({ authorizationUrl: "https://api.descope.com/login/example" }));
    expect(await requestAiAuthorization(send)).toBe("https://api.descope.com/login/example");
    expect(send).toHaveBeenCalledExactlyOnceWith("https://api.monotorr.com/connectwise/v1/ai/link", { method: "POST", credentials: "include", redirect: "error" });
  });
  it("rejects failed, malformed and unsafe linking responses before navigation", async () => {
    for (const response of [new Response("", { status: 503 }), Response.json({}), Response.json({ authorizationUrl: "javascript:alert(1)" }), Response.json({ authorizationUrl: "http://example.com" })])
      await expect(requestAiAuthorization(async () => response)).rejects.toThrow();
  });
});
