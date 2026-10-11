import { useEffect, useState } from "react";
const API = "https://api.monotorr.com/connectwise/v1";
export function AiSetup() {
  const [linked,setLinked] = useState<boolean|null>(null), [failed,setFailed] = useState(false), [busy,setBusy] = useState(false);
  useEffect(()=>{
    const controller = new AbortController();
    void fetch(`${API}/ai/status`,{credentials:"include",redirect:"error",signal:controller.signal}).then(async response=>{
      if (response.status === 404) return; // Default-off server gate, not merely a hidden button.
      if (!response.ok) throw new Error();
      const value = await response.json() as {linked?:unknown};
      if (typeof value.linked !== "boolean") throw new Error();
      setLinked(value.linked);
    }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>controller.abort();
  },[]);
  async function link() {
    setBusy(true);setFailed(false);
    try {
      const response = await fetch(`${API}/ai/link`,{method:"POST",credentials:"include",redirect:"error"});
      if(!response.ok)throw new Error();
      const result = await response.json() as {authorizationUrl:string};
      const url = new URL(result.authorizationUrl);
      if(url.protocol!=="https:")throw new Error();
      window.location.assign(url.href);
    } catch {setBusy(false);setFailed(true);}
  }
  if (linked === null && !failed) return null;
  return <section aria-label="AI Setup"><h3>AI Setup</h3>
    {failed && <p role="alert">AI setup unavailable. Please try again.</p>}
    {linked !== null && <><p>MCP identity: {linked?"Linked":"Not linked"}</p>
      {!linked && <><p>Link the identity you will use to authorize your AI connection.</p><button type="button" disabled={busy} onClick={()=>{void link();}}>Link AI identity</button></>}
      {linked && <p>Add <code>https://api.monotorr.com/mcp</code> in ChatGPT and authorize using the identity you linked. Access also requires active entitlement and a configured ConnectWise connection.</p>}
    </>}
  </section>;
}
