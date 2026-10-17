import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountNameError, accountName, CustomerStore } from "../control-plane/auth/store.js";
import { customerRoutes, SESSION_COOKIE } from "../control-plane/auth/routes.js";
import { API_PREFIX, PORTAL_ORIGIN } from "../control-plane/auth/identity.js";
const componentPath = "../../portal/src/AccountName.tsx";
const { AccountNameContent, saveAccountName } = await import(componentPath);
const context = { userId: "11111111-1111-4111-8111-111111111111", accountId: "22222222-2222-4222-8222-222222222222", name: "Original name" };
const noop = () => {};
function render(extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(AccountNameContent, { name: context.name, draft: context.name, editing: false, busy: false, error: null,
    onEdit: noop, onChange: noop, onSave: noop, onCancel: noop, ...extra }));
}
describe("account display-name validation and minimal write", () => {
  it.each(["New name", "  Example MSP  ", "München & Co.", "O'Connor", "a".repeat(120)])("accepts and trims %j", name => expect(accountName(name)).toBe(name.trim()));
  it.each([null, undefined, 42, {}, [], "", "   ", "a".repeat(121), "\u0000", "Bad\nname", "Bad\tname", "Bad\u007fname", "Bad\u202ename", "Bad\u2028name"])("rejects invalid name %j", value => expect(() => accountName(value)).toThrow("invalid_name"));
  it("updates only name with parameterized active-owner conditions", async () => {
    const query = vi.fn(async () => ({ rows: [{ name: "O'Connor" }] }));
    const store = new CustomerStore({ query } as never);
    expect(await store.rename(context, "  O'Connor  ")).toEqual({ name: "O'Connor" });
    const [sql, args] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(args).toEqual([context.accountId, context.userId, "O'Connor"]);
    expect(sql).toMatch(/UPDATE public.accounts a SET name=\$3/);
    expect(sql).toContain("m.role='owner'"); expect(sql).toContain("u.status='active'"); expect(sql).toContain("a.status='active'");
    expect(sql).not.toMatch(/entitlements|billing|external_identities|connectwise|SET id|SET status/);
  });
  it("fails closed when ownership is absent and validates before database access", async () => {
    const query = vi.fn(async () => ({ rows: [] })); const store = new CustomerStore({ query } as never);
    await expect(store.rename(context, "Name")).rejects.toMatchObject({ code: "forbidden" });
    query.mockClear(); await expect(store.rename(context, " ")).rejects.toMatchObject({ code: "invalid_name" }); expect(query).not.toHaveBeenCalled();
  });
});
async function api() {
  const store = { session: vi.fn(async () => context as typeof context | null), rename: vi.fn(async (_context: unknown, name: unknown) => ({ name: accountName(name) })) };
  const app = express(); app.use(API_PREFIX, customerRoutes(store as never, {} as never, new Uint8Array(32)));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  return { store, url: `http://127.0.0.1:${(server.address() as { port: number }).port}${API_PREFIX}/account/name`,
    headers: { Origin: PORTAL_ORIGIN, Cookie: `${SESSION_COOKIE}=${"a".repeat(43)}`, "Content-Type": "application/json" },
    close: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
describe("account name HTTP authority", () => {
  it("requires authenticated owner session and trusted origin", async () => {
    const f = await api(); try {
      f.store.session.mockResolvedValueOnce(null);
      expect((await fetch(f.url, { method: "POST", headers: f.headers, body: '{"name":"New"}' })).status).toBe(401);
      for (const Origin of ["https://untrusted.example", ""]) expect((await fetch(f.url, { method: "POST", headers: { ...f.headers, Origin }, body: '{"name":"New"}' })).status).toBe(403);
      expect(f.store.rename).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
  it("accepts only the new name and returns sanitized authoritative metadata", async () => {
    const f = await api(); try {
      const r = await fetch(f.url, { method: "POST", headers: f.headers, body: '{"name":"  New name  "}' });
      expect(r.status).toBe(200); expect(await r.json()).toEqual({ account: { name: "New name" } });
      expect(f.store.rename).toHaveBeenCalledExactlyOnceWith(context, "  New name  ");
    } finally { await f.close(); }
  });
  it("rejects cross-account headers, query and extra body fields before writes", async () => {
    const f = await api(); try {
      for (const header of ["X-Account-Id", "X-User-Id", "X-Customer-Id"]) expect((await fetch(f.url, { method: "POST", headers: { ...f.headers, [header]: "foreign" }, body: '{"name":"New"}' })).status).toBe(400);
      expect((await fetch(f.url + "?accountId=foreign", { method: "POST", headers: f.headers, body: '{"name":"New"}' })).status).toBe(400);
      for (const body of ['{"name":"New","accountId":"foreign"}', '{"name":"New","userId":"foreign"}', '{"name":"New","email":"foreign"}', '{}', 'null', '[]', 'broken']) expect((await fetch(f.url, { method: "POST", headers: f.headers, body })).status).toBe(400);
      expect(f.store.rename).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
  it("rejects bad names, oversized, compressed and non-JSON input", async () => {
    const f = await api(); try {
      for (const name of ["", "  ", "a".repeat(121), "Bad\nname", null]) expect((await fetch(f.url, { method: "POST", headers: f.headers, body: JSON.stringify({ name }) })).status).toBe(400);
      for (const headers of [{ ...f.headers, "Content-Type": "text/plain" }, { ...f.headers, "Content-Encoding": "gzip" }]) expect((await fetch(f.url, { method: "POST", headers, body: '{"name":"New"}' })).status).toBe(400);
      expect((await fetch(f.url, { method: "POST", headers: f.headers, body: JSON.stringify({ name: "x".repeat(2000) }) })).status).toBe(400);
    } finally { await f.close(); }
  });
  it("sanitizes database failures and denies revoked owner membership", async () => {
    const f = await api(); try {
      f.store.rename.mockRejectedValueOnce(new Error("synthetic-private-database-detail"));
      let r = await fetch(f.url, { method: "POST", headers: f.headers, body: '{"name":"New"}' });
      expect(r.status).toBe(503); expect(await r.json()).toEqual({ error: "unavailable" });
      f.store.rename.mockRejectedValueOnce(new AccountNameError("forbidden"));
      r = await fetch(f.url, { method: "POST", headers: f.headers, body: '{"name":"New"}' });
      expect(r.status).toBe(403); expect(await r.json()).toEqual({ error: "forbidden" });
    } finally { await f.close(); }
  });
});
describe("compact account name portal", () => {
  it("displays current or unset name with an accessible Edit action", () => {
    expect(render()).toContain("Original name"); expect(render()).toContain('aria-label="Edit account name"');
    expect(render({ name: null })).toContain("Not set"); expect(render()).not.toContain("<input");
  });
  it("opens a labeled inline form with Save/Cancel, without profile fields", () => {
    const html = render({ editing: true });
    expect(html).toContain('for="account-name"'); expect(html).toContain('value="Original name"'); expect(html).toMatch(/maxlength="120"/i);
    expect(html).toContain(">Save</button>"); expect(html).toContain(">Cancel</button>"); expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).not.toMatch(/first.name|last.name|email|phone|avatar/i);
  });
  it("renders recoverable errors and disables duplicate actions while saving", () => {
    const html = render({ editing: true, busy: true, error: "Please try again." });
    expect(html).toContain('role="alert"'); expect(html).toContain('aria-busy="true"'); expect(html).toContain("Saving…");
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
  it("escapes display metadata instead of interpreting it as markup", () => {
    expect(render({ name: '<img src=x onerror="alert(1)">' })).not.toContain("<img");
  });
  it("sends only a name with session/origin protection and accepts only server-confirmed value", async () => {
    const send = vi.fn(async () => Response.json({ account: { name: "Normalized" } }));
    expect(await saveAccountName("  Normalized  ", undefined, send)).toBe("Normalized");
    expect(send).toHaveBeenCalledWith("https://api.monotorr.com/connectwise/v1/account/name", expect.objectContaining({ method: "POST", credentials: "include", redirect: "error", body: '{"name":"  Normalized  "}' }));
    await expect(saveAccountName("New", undefined, async () => Response.json({ account: { id: "foreign" } }))).rejects.toThrow("could not be saved");
  });
  it("sanitizes unknown/network errors and explains invalid names", async () => {
    await expect(saveAccountName("", undefined, async () => Response.json({ error: "invalid_name" }, { status: 400 }))).rejects.toThrow("1–120");
    await expect(saveAccountName("New", undefined, async () => Response.json({ error: "synthetic-secret" }, { status: 503 }))).rejects.toThrow("could not be saved");
    await expect(saveAccountName("New", undefined, async () => { throw new Error("synthetic-secret"); })).rejects.toThrow("could not be saved");
  });
});
