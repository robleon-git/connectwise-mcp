import React, { useRef, useState } from "react";
const API="https://api.monotorr.com/connectwise/v1/connectwise/connection";
const errors:Record<string,string>={invalid_input:"Check the four required fields.",invalid_url:"Use a valid ConnectWise HTTPS server URL.",unsafe_destination:"This destination is not a supported public HTTPS server.",unreachable_host:"The ConnectWise server could not be reached.",tls_failure:"The server certificate could not be verified.",authentication_failed:"ConnectWise rejected these credentials or their permissions.",connectwise_rejected:"The server did not accept the ConnectWise validation request.",entitlement_required:"Active account access is required.",already_configured:"This account already has a ConnectWise connection.",setup_in_progress:"Connection setup is already in progress. Please wait before retrying.",storage_unavailable:"Secure setup could not complete. Please retry later."};
export interface SetupFields {url:string;companyId:string;publicKey:string;privateKey:string}
export async function saveConnection(fields:SetupFields,send:typeof fetch=fetch) {
  try {
    const response=await send(API,{method:"POST",credentials:"include",redirect:"error",headers:{"Content-Type":"application/json"},body:JSON.stringify(fields)});
    if(response.status===201){await response.body?.cancel();return {connected:true,error:null};}
    const body=await response.json() as {error?:unknown};
    return {connected:false,error:typeof body.error==="string"&&Object.hasOwn(errors,body.error)?errors[body.error]:"Connection setup could not complete. Please try again."};
  } catch {return {connected:false,error:"Connection setup could not complete. Please try again."};}
}
export function ConnectionForm({onConnected}:{onConnected:()=>void}) {
  const [fields,setFields]=useState<SetupFields>({url:"",companyId:"",publicKey:"",privateKey:""});
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const inFlight = useRef(false);
  async function submit(event:React.FormEvent) {
    event.preventDefault();if(inFlight.current)return;inFlight.current=true;
    const submitted={...fields};setFields({...fields,publicKey:"",privateKey:""});setBusy(true);setError(null);
    const result=await saveConnection(submitted);submitted.publicKey="";submitted.privateKey="";inFlight.current=false;setBusy(false);
    if(result.connected)onConnected();else setError(result.error);
  }
  return <form onSubmit={event=>{void submit(event);}} autoComplete="off"><h3>Connect ConnectWise</h3>
    <p>Use your dedicated read-only ConnectWise Manage API member credentials. All four fields are required. Testing validates and saves your connection.</p>
    {([['url','ConnectWise URL'],['companyId','Company ID'],['publicKey','Public API Key'],['privateKey','Private API Key']] as const).map(([key,label])=><label key={key}>{label}
      <input name={key} type={key==='publicKey'||key==='privateKey'?'password':key==='url'?'url':'text'} value={fields[key]} required disabled={busy} autoComplete="off"
        maxLength={key==='url'?2048:key==='companyId'?100:512} onChange={event=>setFields({...fields,[key]:event.target.value})}/></label>)}
    {error&&<p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy?'Testing connection…':'Test and save'}</button>
    <p>API keys are cleared from this form when submitted and are never displayed after saving.</p>
  </form>;
}
