import React, { useEffect, useRef, useState } from "react";
import { AiClientInstructions } from "./AiClientInstructions";
const API = "https://api.monotorr.com/connectwise/v1";
export async function requestAiAuthorization(send: typeof fetch = fetch): Promise<string> {
  const response = await send(`${API}/ai/link`, { method: "POST", credentials: "include", redirect: "error" });
  if (!response.ok) throw new Error("ai_unavailable");
  const result = await response.json() as { authorizationUrl?: unknown };
  if (typeof result.authorizationUrl !== "string") throw new Error("ai_unavailable");
  const url = new URL(result.authorizationUrl);
  if (url.protocol !== "https:") throw new Error("ai_unavailable");
  return url.href;
}
export function AiSetupContent({ linked, failed, busy, unavailable, onRetry, onConnect }: {
  linked: boolean | null; failed: boolean; busy: boolean; unavailable: boolean;
  onRetry: () => void; onConnect: () => void;
}) {
  if (unavailable) return <p>AI setup is temporarily unavailable. Please try again later.</p>;
  if (failed) return <div><p role="alert">We couldn’t prepare your AI setup. Please try again.</p><button type="button" onClick={onRetry}>Try again</button></div>;
  if (linked === null) return <p role="status">Checking your AI setup…</p>;
  return linked ? <><p className="status">Ready to connect</p><p>Monotorr is ready to be added to your AI assistant. Finish setup in your assistant to start asking questions.</p><AiClientInstructions /></> :
    <><p>Confirm the email sign-in you’ll use with your AI.</p><button type="button" disabled={busy} onClick={onConnect}>{busy ? "Opening sign-in…" : "Connect your AI"}</button><span className="sr-only" role="status">{busy ? "Opening sign-in…" : ""}</span></>;
}
export function AiSetup() {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false), [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API}/ai/status`, { credentials: "include", redirect: "error", signal: controller.signal }).then(async response => {
      if (response.status === 404) { if (!controller.signal.aborted) setUnavailable(true); return; }
      if (!response.ok) throw new Error();
      const value = await response.json() as { linked?: unknown };
      if (typeof value.linked !== "boolean") throw new Error();
      if (!controller.signal.aborted) { setLinked(value.linked); setFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [refresh]);
  async function connect() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailed(false);
    try { window.location.assign(await requestAiAuthorization()); }
    catch { inFlight.current = false; setBusy(false); setFailed(true); }
  }
  function retry() { setFailed(false); setLinked(null); setUnavailable(false); setRefresh(n => n + 1); }
  return <AiSetupContent linked={linked} failed={failed} busy={busy} unavailable={unavailable} onRetry={retry} onConnect={() => { void connect(); }} />;
}
