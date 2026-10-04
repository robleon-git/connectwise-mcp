/**
 * cw_update_agreement_addition / cw_create_agreement_addition: JSON Patch
 * and create tools for agreement additions (recurring line items), plus the
 * update tool's dryRun preview mode.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "./worker-fixture.js";
import { applyPatchLocally } from "../tools/agreements.js";

const GATEWAY_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "X-CW-Company-Id": "acme",
  "X-CW-Public-Key": "pub",
  "X-CW-Private-Key": "priv",
  "X-CW-Client-Id": "client-guid",
};


async function mcp(method: string, params: unknown, id = 1): Promise<Record<string, unknown>> {
  const res = await worker.fetch(
    new Request("http://worker.local/mcp", {
      method: "POST",
      headers: GATEWAY_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    { AUTH_MODE: "gateway" },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}


afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyPatchLocally", () => {
  it("replaces, adds, and removes flat fields", () => {
    const result = applyPatchLocally(
      { id: 1, quantity: 5, billCustomer: "Billable" },
      [
        { op: "replace", path: "quantity", value: 12 },
        { op: "add", path: "cancelledDate", value: "2026-10-01" },
        { op: "remove", path: "billCustomer" },
      ],
    );
    expect(result).toEqual({ id: 1, quantity: 12, cancelledDate: "2026-10-01" });
  });

  it("does not mutate the input record", () => {
    const input = { id: 1, quantity: 5 };
    applyPatchLocally(input, [{ op: "replace", path: "quantity", value: 99 }]);
    expect(input.quantity).toBe(5);
  });
});

describe("agreement addition tools", () => {
  it("does not expose agreement addition writes", async () => {
    const body = await mcp("tools/list", {});
    const tools = (body.result as { tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[] }).tools;
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    expect(byName.cw_update_agreement_addition).toBeUndefined();
    expect(byName.cw_create_agreement_addition).toBeUndefined();
  });

  it("rejects addition updates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_update_agreement_addition", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed calls to removed update tools", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_update_agreement_addition", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects even dry-run calls to removed update tools", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_update_agreement_addition", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects addition creates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_create_agreement_addition", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
