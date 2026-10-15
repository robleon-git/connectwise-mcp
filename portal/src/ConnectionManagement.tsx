import React, { useEffect, useRef, useState } from "react";
import { ConnectionForm, connectionErrors } from "./ConnectionForm";
const API="https://api.monotorr.com/connectwise/v1/connectwise/connection";
export async function connectionAction(action:"test"|"disconnect",signal?:AbortSignal,send:typeof fetch=fetch) {
  const response=await send(`${API}/${action}`,{method:"POST",credentials:"include",redirect:"error",headers:{"Content-Type":"application/json"},body:"{}",signal}).catch(()=>{throw new Error("Could not reach Monotorr. Please try again.");});
  if(response.ok){await response.body?.cancel();return;}
  let code:unknown;try{code=(await response.json() as {error?:unknown}).error;}catch{/* Untrusted response details never reach the UI. */}
  throw new Error(typeof code==="string"&&Object.hasOwn(connectionErrors,code)?connectionErrors[code]:"Please try again. If the problem continues, contact support.");
}
export function ConnectionManagement({saved,canValidate,enabled,onChanged}:{saved:{host?:string;serverUrl?:string;companyId?:string};canValidate:boolean;enabled:boolean;onChanged:()=>void}) {
  const [editing,setEditing]=useState(false),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState<"test"|"disconnect"|null>(null),[message,setMessage]=useState<string|null>(null),[failed,setFailed]=useState(false);
  const inFlight=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function run(action:"test"|"disconnect") {
    if(inFlight.current)return;inFlight.current=true;controller.current=new AbortController();const signal=controller.current.signal;
    setBusy(action);setMessage(null);setFailed(false);
    try {await connectionAction(action,signal);if(!signal.aborted){if(action==="disconnect")onChanged();else setMessage("Connection successful.");}}
    catch(error){if(!signal.aborted){setFailed(true);setMessage(`${action==="test"?"Connection failed":"Disconnect failed"} — ${error instanceof Error?error.message:"Please try again."}`);}}
    finally{inFlight.current=false;if(!signal.aborted)setBusy(null);}
  }
  return <>
    <p>Your ConnectWise connection is saved.</p>
    <dl><dt>Server</dt><dd>{saved.serverUrl??saved.host}</dd><dt>Company</dt><dd>{saved.companyId}</dd></dl>
    {editing&&canValidate ? <ConnectionForm initial={{url:saved.serverUrl??`https://${saved.host}`,companyId:saved.companyId??""}} onCancel={()=>setEditing(false)} onConnected={()=>{setEditing(false);onChanged();}}/> : enabled ? <div className="connection-actions">
      <button type="button" disabled={!canValidate||!!busy||confirm} onClick={()=>{void run("test");}}>{busy==="test"?"Testing connection…":"Test connection"}</button>
      <button type="button" className="secondary" disabled={!canValidate||!!busy||confirm} onClick={()=>{setMessage(null);setEditing(true);}}>Edit</button>
      <button type="button" className="secondary danger" disabled={!!busy||confirm} onClick={()=>{setMessage(null);setConfirm(true);}}>Remove</button>
    </div> : null}
    {message&&<p role={failed?"alert":"status"}>{message}</p>}
    {confirm&&<div className="connection-confirm" role="group" aria-labelledby="disconnect-heading">
      <h3 id="disconnect-heading">Disconnect ConnectWise?</h3><p>This will remove Monotorr’s active connection to your ConnectWise environment. Your Monotorr account and billing history will remain intact.</p>
      <button type="button" className="secondary" disabled={!!busy} onClick={()=>setConfirm(false)}>Cancel</button>
      <button type="button" className="danger" disabled={!!busy} onClick={()=>{void run("disconnect");}}>{busy==="disconnect"?"Disconnecting…":"Disconnect"}</button>
    </div>}
  </>;
}
