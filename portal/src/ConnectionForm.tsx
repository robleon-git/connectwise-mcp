import React, { useRef, useState } from "react";
const API="https://api.monotorr.com/connectwise/v1/connectwise/connection";
export const connectionErrors:Record<string,string>={not_configured:"No active ConnectWise connection was found. Refresh your account.",invalid_input:"Check the server, company and credentials. Enter both replacement keys or leave both blank.",invalid_url:"Use a valid ConnectWise HTTPS server URL.",unsafe_destination:"This destination is not a supported public HTTPS server.",unreachable_host:"The ConnectWise server could not be reached.",tls_failure:"The server certificate could not be verified.",authentication_failed:"ConnectWise rejected these credentials or their permissions.",connectwise_rejected:"The server did not accept the ConnectWise validation request.",entitlement_required:"Active account access is required.",already_configured:"This account already has a ConnectWise connection.",setup_in_progress:"Connection setup is already in progress. Please wait before retrying.",storage_unavailable:"Secure setup could not complete. Please retry later."};
export interface SetupFields {url:string;companyId:string;publicKey:string;privateKey:string}
export async function saveConnection(fields:SetupFields,send:typeof fetch=fetch,editing=false) {
  try {
    const response=await send(API+(editing?"/edit":""),{method:"POST",credentials:"include",redirect:"error",headers:{"Content-Type":"application/json"},body:JSON.stringify(editing&&!fields.publicKey&&!fields.privateKey?{url:fields.url,companyId:fields.companyId}:fields)});
    if(response.status===(editing?200:201)){await response.body?.cancel();return {connected:true,error:null};}
    const body=await response.json() as {error?:unknown};
    return {connected:false,error:typeof body.error==="string"&&Object.hasOwn(connectionErrors,body.error)?connectionErrors[body.error]:"Connection setup could not complete. Please try again."};
  } catch {return {connected:false,error:"Connection setup could not complete. Please try again."};}
}
export function ConnectionForm({onConnected,initial,onCancel}:{onConnected:()=>void;initial?:{url:string;companyId:string};onCancel?:()=>void}) {
  const editing=!!initial;
  const [fields,setFields]=useState<SetupFields>({url:initial?.url??"",companyId:initial?.companyId??"",publicKey:"",privateKey:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const inFlight = useRef(false);
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current)return;inFlight.current=true;
    const submitted={...fields};setFields({...fields,publicKey:"",privateKey:""});setBusy(true);setError(null);
    const result=await saveConnection(submitted,fetch,editing);submitted.publicKey="";submitted.privateKey="";inFlight.current=false;setBusy(false);
    if(result.connected)onConnected();else setError(result.error);
  }
  return <form onSubmit={event=>{void submit(event);}} autoComplete="off"><h3>{editing?"Edit ConnectWise connection":"Connect ConnectWise"}</h3>
    <p>{editing?"Leave both API key fields blank to keep your current credentials, or enter both replacement keys. Your saved connection stays active until the replacement is verified and saved.":"Use your dedicated read-only ConnectWise Manage API member credentials. All four fields are required. Testing validates and saves your connection."}</p>
    {([['url','ConnectWise URL'],['companyId','Company ID'],['publicKey','Public API Key'],['privateKey','Private API Key']] as const).map(([key,label])=><label key={key}>{label}
      <input name={key} type={key==='publicKey'||key==='privateKey'?'password':key==='url'?'url':'text'} value={fields[key]} required={!editing||key==='url'||key==='companyId'||!!fields.publicKey||!!fields.privateKey} disabled={busy} autoComplete="off"
        maxLength={key==='url'?2048:key==='companyId'?100:512} onChange={event=>setFields({...fields,[key]:event.target.value})}/></label>)}
    {error&&<p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy?'Testing connection…':'Test and save'}</button>
    {onCancel&&<button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>}
    <p>API keys are cleared from this form when submitted and are never displayed after saving.</p>
  </form>;
}
