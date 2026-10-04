/**
 * WYREAI-400: note email flags, parent ticket create, contact type search,
 * time entry update/delete, and honest note-create visibility flags.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import worker from "./worker-fixture.js";
import { buildTicketNoteBody, mapCreatedNoteResponse } from "../tools/note-payload.js";
import { buildContactSearchQuery } from "../tools/contact-search.js";

const GATEWAY_HEADERS = {
  Accept: "application/json, text/event-stream",
  "Content-Type": "application/json",
  "X-CW-Company-Id": "acme",
  "X-CW-Public-Key": "pub",
  "X-CW-Private-Key": "priv",
  "X-CW-Client-Id": "client-guid",
};

function fakeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body === undefined ? "" : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

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

describe("ticket note email payload (A1)", () => {
  it("omits email fields and does not set processNotifications by default", () => {
    expect(buildTicketNoteBody({ text: "hello" })).toEqual({ text: "hello" });
  });

  it("forwards email flags only when set, and turns on processNotifications for a true flag", () => {
    expect(
      buildTicketNoteBody({
        text: "question for the client",
        detailDescriptionFlag: true,
        emailContactFlag: true,
        emailCc: "billing@example.com",
      }),
    ).toEqual({
      text: "question for the client",
      detailDescriptionFlag: true,
      emailContactFlag: true,
      emailCc: "billing@example.com",
      processNotifications: true,
    });
  });

  it("does not email when flags are explicitly false", () => {
    const body = buildTicketNoteBody({
      text: "internal",
      internalAnalysisFlag: true,
      emailContactFlag: false,
      emailResourceFlag: false,
      emailCcFlag: false,
      emailCc: "nobody@example.com",
    });
    expect(body.emailContactFlag).toBe(false);
    expect(body.emailResourceFlag).toBe(false);
    expect(body.emailCcFlag).toBe(false);
    expect(body.processNotifications).toBeUndefined();
  });

  it("lets an explicit processNotifications false suppress delivery", () => {
    expect(
      buildTicketNoteBody({
        text: "hold",
        emailContactFlag: true,
        processNotifications: false,
      }).processNotifications,
    ).toBe(false);
  });

  it("emails CC only when emailCcFlag is true", () => {
    const body = buildTicketNoteBody({
      text: "copy",
      emailCcFlag: true,
      emailCc: "a@example.com;b@example.com",
    });
    expect(body.emailCcFlag).toBe(true);
    expect(body.emailCc).toBe("a@example.com;b@example.com");
    expect(body.processNotifications).toBe(true);
  });
});

describe("note create visibility mapping (A5)", () => {
  it("does not claim both internal and external on an internal-only note", () => {
    const mapped = mapCreatedNoteResponse(
      {
        id: 9,
        text: "staff only",
        internalAnalysisFlag: true,
        detailDescriptionFlag: false,
        resolutionFlag: false,
        internalFlag: true,
        externalFlag: true,
      },
      { internalAnalysisFlag: true },
    );
    expect(mapped.internalFlag).toBe(true);
    expect(mapped.externalFlag).toBe(false);
  });

  it("marks a discussion note external", () => {
    const mapped = mapCreatedNoteResponse({
      id: 10,
      detailDescriptionFlag: true,
      internalAnalysisFlag: false,
      internalFlag: true,
      externalFlag: true,
    });
    expect(mapped.internalFlag).toBe(false);
    expect(mapped.externalFlag).toBe(true);
  });

  it("keeps both when the note was stored as both discussion and internal", () => {
    const mapped = mapCreatedNoteResponse({
      detailDescriptionFlag: true,
      internalAnalysisFlag: true,
      internalFlag: true,
      externalFlag: true,
    });
    expect(mapped.internalFlag).toBe(true);
    expect(mapped.externalFlag).toBe(true);
  });

  it("uses the requested type flags when the create payload omits them", () => {
    const mapped = mapCreatedNoteResponse(
      { id: 11, text: "staff only", internalFlag: true, externalFlag: true },
      { internalAnalysisFlag: true },
    );
    expect(mapped.internalFlag).toBe(true);
    expect(mapped.externalFlag).toBe(false);
  });

  it("returns null visibility when nothing was stored, matching read-back", () => {
    const mapped = mapCreatedNoteResponse({
      id: 12,
      text: "note",
      internalFlag: true,
      externalFlag: true,
    });
    expect(mapped.internalFlag).toBeNull();
    expect(mapped.externalFlag).toBeNull();
  });
});

describe("contact search conditions (A3)", () => {
  it("moves types/name out of conditions into childConditions and fixes quotes", () => {
    expect(
      buildContactSearchQuery({
        conditions: "company/id = 5 and types/name = 'Decision Maker'",
      }),
    ).toEqual({
      conditions: "company/id = 5",
      childConditions: 'types/name = "Decision Maker"',
    });
  });

  it("rewrites a bare types equality into types/name", () => {
    expect(buildContactSearchQuery({ conditions: "types = 'Primary'" })).toEqual({
      conditions: undefined,
      childConditions: 'types/name = "Primary"',
    });
  });

  it("filters by typeName without a raw conditions string", () => {
    expect(buildContactSearchQuery({ typeName: 'Say "Hi"', typeId: 4 })).toEqual({
      conditions: undefined,
      childConditions: 'types/id=4 and types/name="Say \\"Hi\\""',
    });
  });

  it("rewrites a bare name comparison to firstName or lastName", () => {
    expect(buildContactSearchQuery({ conditions: "name = 'Ada'" })).toEqual({
      conditions: '(firstName = "Ada" or lastName = "Ada")',
      childConditions: undefined,
    });
  });

  it("leaves company/name on the parent query", () => {
    expect(buildContactSearchQuery({ conditions: 'company/name = "Acme"' })).toEqual({
      conditions: 'company/name = "Acme"',
      childConditions: undefined,
    });
  });
});

describe("WYREAI-400 tool wiring", () => {
  it("preserves contact filters and omits write tools", async () => {
    const body = await mcp("tools/list", {});
    const tools = (body.result as { tools: { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }[] }).tools;
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    expect(byName.cw_add_ticket_note).toBeUndefined();
    expect(byName.cw_create_ticket).toBeUndefined();
    expect(byName.cw_search_contacts.inputSchema?.properties).toHaveProperty("typeName");
    expect(byName.cw_search_contacts.inputSchema?.properties).toHaveProperty("childConditions");
    expect(byName.cw_search_contacts.description).toMatch(/ApiFindCondition/);
    expect(byName.cw_update_time_entry).toBeUndefined();
    expect(byName.cw_delete_time_entry).toBeUndefined();
  });

  it("rejects ticket creates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_create_ticket", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects note creates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_add_ticket_note", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches contacts by type via childConditions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await mcp("tools/call", {
      name: "cw_search_contacts",
      arguments: { conditions: "types/name = 'Decision Maker'", typeName: "Primary" },
    });

    const [url] = fetchMock.mock.calls[0] as [string];
    const params = new URL(url).searchParams;
    expect(params.get("conditions")).toBeNull();
    expect(params.get("childConditions")).toBe('types/name = "Decision Maker" and types/name="Primary"');
  });

  it("rejects time entry updates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = await mcp("tools/call", {name: "cw_update_time_entry", arguments: {}});
    expect(JSON.stringify(body)).toMatch(/not found/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
