import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { AccountName } from "./AccountName";
import { Billing } from "./Billing";
import { AiSetup } from "./AiSetup";
import { ConnectionManagement } from "./ConnectionManagement";
import { ConnectionForm } from "./ConnectionForm";
const API = "https://api.monotorr.com/connectwise/v1";
export interface Status {
  account: { id: string; name: string | null };
  entitlement: { allowed: boolean; status: "active" | "expired" | "inactive"; accessKind: "trial" | "standard" | null;
    trial: { status: "active" | "expired" | "inactive"; startsAt: string; expiresAt: string } | null };
  connectwise: { status: "not_configured" | "connected"; setupAvailable?: boolean; host?: string; serverUrl?: string; managementAvailable?: boolean; companyId?: string };
}
export function PortalContent({ status, loading, error, setup, onRetry, onSetup, onConnected, onLogout, onAccountRefresh }: {
  status: Status | null; loading: boolean; error: boolean; setup: boolean;
  onRetry: () => void; onSetup: () => void; onConnected: () => void; onLogout: () => void; onAccountRefresh?: () => void;
}) {
  const allowed = status?.entitlement.allowed === true;
  const connected = status?.connectwise.status === "connected";
  const expired = status?.entitlement.status === "expired";
  return <main>
    <header><h1>Monotorr</h1><p className="tagline">Your ConnectWise data. Your AI.</p></header>
    {loading ? <p role="status">Loading your account…</p> : error ?
      <div><p role="alert">We couldn’t load your account. Please try again.</p><button type="button" onClick={onRetry}>Try again</button></div> : status ? <>
        {!allowed && <p role="alert" className="access-notice">{expired ? "Your access has expired." : "Your account access is not active."} Setup is unavailable until your access is active.</p>}
        <section aria-labelledby="connectwise-heading"><h2 id="connectwise-heading">ConnectWise</h2>
          <p className="status">{connected ? "Connected" : "Not configured"}</p>
          {connected ? <ConnectionManagement saved={status.connectwise} enabled={status.connectwise.managementAvailable===true} canValidate={allowed&&status.connectwise.setupAvailable===true} onChanged={onConnected} /> :
            allowed ? <><p>Connect your ConnectWise environment to get started.</p>{status.connectwise.setupAvailable ?
              setup ? <ConnectionForm onConnected={onConnected} /> : <button type="button" onClick={onSetup}>Connect ConnectWise</button> :
              <p>Connection setup is temporarily unavailable. Please try again later.</p>}</> : null}
        </section>
        <section aria-labelledby="ai-heading"><h2 id="ai-heading">Connect your AI</h2>
          {!allowed ? <p>AI setup is available when your account access is active.</p> : !connected ?
            <p>Connect ConnectWise first. Then confirm the email sign-in you’ll use with your AI.</p> : <AiSetup />}
        </section>
        <section aria-labelledby="account-heading"><h2 id="account-heading">Account</h2>
          <AccountName name={status.account.name} onSaved={onAccountRefresh} />
          <p className="status">{allowed ? status.entitlement.accessKind === "trial" ? "Trial active" : "Access active" : expired ? "Access expired" : "Access not active"}</p>
          {status.entitlement.trial && <p>Trial expiration: <time dateTime={status.entitlement.trial.expiresAt}>{new Date(status.entitlement.trial.expiresAt).toLocaleString()}</time></p>}
          <Billing onAccountRefresh={onAccountRefresh} />
          <button type="button" className="secondary" onClick={onLogout}>Log out</button>
        </section>
      </> : <section><h2>Your account</h2><p>Sign in with your Microsoft business account to get started.</p>
        <a className="button" href={`${API}/auth/login`}>Sign in with Microsoft</a></section>}
  </main>;
}
export function CustomerPortal() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [setup, setSetup] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API}/account/status`, { credentials: "include", signal: controller.signal, redirect: "error" })
      .then(async response => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error();
        return await response.json() as Status;
      }).then(value => { if (!controller.signal.aborted) { setStatus(value); setError(false); setLoading(false); } })
      .catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    return () => controller.abort();
  }, [refresh]);
  const refreshAccess = useCallback(() => { setRefresh(n => n + 1); }, []);
  function retry() { setError(false); setLoading(true); setRefresh(n => n + 1); }
  async function logout() {
    setError(false);
    try {
      const response = await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include", redirect: "error" });
      if (!response.ok) throw new Error();
      setStatus(null); setSetup(false);
    } catch { setError(true); }
  }
  return <PortalContent status={status} loading={loading} error={error} setup={setup} onRetry={retry}
    onAccountRefresh={refreshAccess} onSetup={() => setSetup(true)} onConnected={() => { setSetup(false); retry(); }} onLogout={() => { void logout(); }} />;
}
if (typeof document !== "undefined") {
  const root = document.getElementById("root");
  if (!root) throw new Error("Portal unavailable");
  createRoot(root).render(<React.StrictMode><CustomerPortal /></React.StrictMode>);
}
