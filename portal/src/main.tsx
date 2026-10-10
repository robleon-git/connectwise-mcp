import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { ConnectionForm } from "./ConnectionForm";
const API = "https://api.monotorr.com/connectwise/v1";
interface Status {
  account: { id: string; name: string | null };
  entitlement: { allowed: boolean; source: string | null; status: string; expiresAt: string | null };
  connectwise: { status: "not_configured" | "connected"; setupAvailable?:boolean; host?:string; companyId?:string };
}
function CustomerPortal() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [setup,setSetup]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${API}/account/status`, { credentials: "include", signal: controller.signal, redirect: "error" })
      .then(async response => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error();
        return await response.json() as Status;
      }).then(value => { setStatus(value); setLoading(false); })
      .catch(() => { if (!controller.signal.aborted) { setError(true); setLoading(false); } });
    return () => controller.abort();
  }, [refresh]);
  async function logout() {
    setError(false);
    try {
      const response = await fetch(`${API}/auth/logout`, { method: "POST", credentials: "include", redirect: "error" });
      if (!response.ok) throw new Error();
      setStatus(null);setSetup(false);
    } catch { setError(true); }
  }
  return <main><h1>Monotorr ConnectWise</h1><p>Your ConnectWise data. Your AI.</p>
    {loading ? <p role="status">Loading your account…</p> : <>
      {error && <p role="alert">Account service unavailable. Please try again.</p>}
      {status ? <section aria-label="Account status"><h2>{status.account.name || "Your account"}</h2>
        <dl><dt>Access source</dt><dd>{status.entitlement.source || "None"}</dd>
          <dt>Entitlement status</dt><dd>{status.entitlement.status}</dd>
          <dt>Trial expiration</dt><dd>{status.entitlement.expiresAt ? new Date(status.entitlement.expiresAt).toLocaleString() : "—"}</dd>
          <dt>ConnectWise status</dt><dd>{status.connectwise.status==='connected'?'Connected':'Not configured'}</dd></dl>
        {!status.entitlement.allowed && <p>Your trial access is not active.</p>}
        {status.connectwise.status==='connected'?<><p>ConnectWise connection validated.</p><p>{status.connectwise.host} — {status.connectwise.companyId}</p></>:
          <><p>Next action: Connect ConnectWise</p>{status.connectwise.setupAvailable&&status.entitlement.allowed?
          setup?<ConnectionForm onConnected={()=>{setSetup(false);setLoading(true);setRefresh(n=>n+1);}}/>:<button type="button" onClick={()=>setSetup(true)}>Connect ConnectWise</button>:
          <p>Connection setup is not currently available.</p>}</>}
        <button type="button" onClick={() => { void logout(); }}>Log out</button>
      </section> : <><h2>Your account</h2><p>Sign up or sign in with your Microsoft business account.</p>
        <a href={`${API}/auth/login`}>Sign in / Sign up with Microsoft</a></>}
    </>}
  </main>;
}
const root = document.getElementById("root");
if (!root) throw new Error("Portal unavailable");
createRoot(root).render(<React.StrictMode><CustomerPortal /></React.StrictMode>);
