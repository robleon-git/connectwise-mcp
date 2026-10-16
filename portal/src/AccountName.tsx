import React, { useEffect, useRef, useState } from "react";
const API = "https://api.monotorr.com/connectwise/v1/account/name";
export async function saveAccountName(name: string, signal?: AbortSignal, send: typeof fetch = fetch): Promise<string> {
  try {
    const response = await send(API, { method: "POST", credentials: "include", redirect: "error", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const body = await response.json() as { account?: { name?: unknown }; error?: unknown };
    if (response.ok && typeof body.account?.name === "string" && body.account.name.trim() && body.account.name.length <= 120) return body.account.name;
    if (body.error === "invalid_name") throw new Error("Enter an account name of 1–120 characters without control characters.");
    if (body.error === "unauthorized") throw new Error("Sign in again to update your account name.");
    throw new Error();
  } catch (error) {
    if (error instanceof Error && ["Enter an account name of 1–120 characters without control characters.", "Sign in again to update your account name."].includes(error.message)) throw error;
    throw new Error("Your account name could not be saved. Please try again.", { cause: error });
  }
}
interface NameProps {
  name: string | null; editing: boolean; draft: string; busy: boolean; error: string | null;
  onEdit: () => void; onCancel: () => void; onChange: (name: string) => void; onSave: () => void;
}
export function AccountNameContent({ name, editing, draft, busy, error, onEdit, onCancel, onChange, onSave }: NameProps) {
  return editing ? <form aria-busy={busy} onSubmit={event => { event.preventDefault(); onSave(); }}>
    <label htmlFor="account-name">Account name
      <input id="account-name" name="name" value={draft} required maxLength={120} disabled={busy}
        aria-describedby={error ? "account-name-error" : undefined} onChange={event => onChange(event.target.value)} />
    </label>
    {error && <p id="account-name-error" role="alert">{error}</p>}
    <div className="actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form> : <div><p><strong>Account name</strong><br />{name ?? "Not set"}</p>
    <button type="button" className="secondary" aria-label="Edit account name" onClick={onEdit}>Edit</button></div>;
}
export function AccountName({ name, onSaved }: { name: string | null; onSaved?: () => void }) {
  const [saved, setSaved] = useState(name), [draft, setDraft] = useState(name ?? ""), [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false), controller = useRef<AbortController | null>(null);
  useEffect(() => { setSaved(name); }, [name]);
  useEffect(() => () => controller.current?.abort(), []);
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true; controller.current = new AbortController(); const signal = controller.current.signal;
    setBusy(true); setError(null);
    try {
      const updated = await saveAccountName(draft, signal);
      if (!signal.aborted) { setSaved(updated); setDraft(updated); setEditing(false); onSaved?.(); }
    } catch (error) { if (!signal.aborted) setError((error as Error).message); }
    finally { inFlight.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <AccountNameContent name={saved} editing={editing} draft={draft} busy={busy} error={error}
    onEdit={() => { setDraft(saved ?? ""); setError(null); setEditing(true); }}
    onCancel={() => { setDraft(saved ?? ""); setError(null); setEditing(false); }} onChange={setDraft} onSave={() => { void save(); }} />;
}
