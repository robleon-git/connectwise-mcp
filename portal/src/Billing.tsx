import React,{useEffect,useRef,useState} from "react";
const API="https://api.monotorr.com/connectwise/v1";
export interface BillingStatus {enabled:boolean;canSubscribe:boolean;canManage:boolean;state:"trial"|"active"|"payment_attention"|"inactive"|"pending";priceDisplay:"$29/month"}
export function parseBillingStatus(value:unknown):BillingStatus {
  if(!value||typeof value!=='object')throw Error('billing_unavailable');const v=value as Record<string,unknown>;
  if(v.enabled!==true||typeof v.canSubscribe!=='boolean'||typeof v.canManage!=='boolean'||!['trial','active','payment_attention','inactive','pending'].includes(String(v.state))||v.priceDisplay!=='$29/month')throw Error('billing_unavailable');
  return {enabled:true,canSubscribe:v.canSubscribe,canManage:v.canManage,state:v.state as BillingStatus['state'],priceDisplay:'$29/month'};
}
export async function requestBilling(action:'checkout'|'portal',send:typeof fetch=fetch):Promise<string>{
  const r=await send(`${API}/billing/${action}`,{method:'POST',credentials:'include',redirect:'error',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('billing_unavailable');const v=await r.json() as {url?:unknown};if(typeof v.url!=='string')throw Error('billing_unavailable');const u=new URL(v.url);if(u.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com'].includes(u.hostname)||u.username||u.password||u.port)throw Error('billing_unavailable');return u.href;
}
export type ReturnPhase = "idle" | "waiting" | "exhausted";
const POLL_INTERVAL = 2500;
const POLL_ATTEMPTS = 8;
const POLL_DEADLINE = 30000;
/** The return marker starts GETs only. Every displayed state comes from the server. */
export function refreshBillingStatus({ checkoutReturn, onStatus, onPhase, onAccountRefresh, onError, send = fetch }: {
  checkoutReturn: boolean;
  onStatus: (status: BillingStatus | null) => void;
  onPhase: (phase: ReturnPhase) => void;
  onAccountRefresh: () => void;
  onError?: () => void;
  send?: typeof fetch;
}) {
  const controller = new AbortController();
  let stopped = false, attempts = 0, previous: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  function stop() {
    stopped = true;
    clearTimeout(timer); clearTimeout(deadline); controller.abort();
  }
  function expire() { if (!stopped) { if (previous === undefined) onError?.(); onPhase("exhausted"); stop(); } }
  onPhase(checkoutReturn ? "waiting" : "idle");
  if (checkoutReturn) deadline = setTimeout(expire, POLL_DEADLINE);
  async function read() {
    attempts += 1;
    try {
      const response = await send(`${API}/billing/status`, { credentials: "include", redirect: "error", signal: controller.signal });
      if (stopped) return;
      if (response.status === 404) { onStatus(null); onPhase("idle"); stop(); return; }
      if (!response.ok) throw Error("billing_unavailable");
      const current = parseBillingStatus(await response.json());
      if (stopped) return;
      const fingerprint = JSON.stringify(current);
      onStatus(current);
      if (fingerprint !== previous && (previous !== undefined || checkoutReturn)) onAccountRefresh();
      previous = fingerprint;
      if (!checkoutReturn || current.state === "active" || current.state === "payment_attention") {
        onPhase("idle"); stop(); return;
      }
    } catch {
      if (stopped) return;
      if (!checkoutReturn) { onError?.(); onPhase("idle"); stop(); return; }
    }
    if (attempts >= POLL_ATTEMPTS) { expire(); return; }
    timer = setTimeout(() => { void read(); }, POLL_INTERVAL);
  }
  void read();
  return stop;
}
export function BillingContent({status,busy,error,onSubscribe,onManage,onRetry,phase="idle"}:{status:BillingStatus|null;busy:boolean;error:boolean;onSubscribe:()=>void;onManage:()=>void;onRetry:()=>void;phase?:ReturnPhase}){
  if(error)return <div className="billing"><h3>Billing</h3><p role="alert">We couldn’t open billing. Please try again.</p><button type="button" className="secondary" onClick={onRetry}>{phase === "exhausted" ? "Refresh" : "Try again"}</button></div>;
  if(!status?.enabled)return null;
  const pending = phase !== "idle";
  return <div className="billing"><h3>Billing</h3>
    <p role={pending ? "status" : undefined}>{pending ? phase === "waiting" ? "Checking billing confirmation. Your account access is shown above." : "Billing confirmation is still pending. Refresh to check again. Your account access is shown above." : status?.state==='active'?'Your subscription is active.':status?.state==='payment_attention'?'Your payment needs attention. Manage billing to update your payment details. Your account access is shown above.':status?.state==='pending'?'Your subscription is awaiting confirmation.':'Subscribe when you’re ready. Your current account access is shown above.'}</p>
    <div className="actions">{status?.canSubscribe&&<button type="button" disabled={busy||pending} onClick={onSubscribe}>Subscribe — $29/month</button>}{status?.canManage&&<button type="button" className={status.canSubscribe?'secondary':undefined} disabled={busy} onClick={onManage}>Manage billing</button>}{phase === "exhausted" && <button type="button" className="secondary" onClick={onRetry}>Refresh</button>}</div>
    <p className="helper">Billing changes don’t remove your saved ConnectWise connection.</p><span className="sr-only" role="status">{busy?'Opening billing…':''}</span>
  </div>;
}
export function Billing({onAccountRefresh}:{onAccountRefresh?:()=>void}){
  const [status,setStatus]=useState<BillingStatus|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[phase,setPhase]=useState<ReturnPhase>("idle");const inFlight=useRef(false);
  useEffect(()=>{
    setError(false);
    const checkoutReturn = new URLSearchParams(window.location.search).get("billing") === "return";
    const stop = refreshBillingStatus({checkoutReturn,onStatus:setStatus,onPhase:setPhase,onError:()=>setError(true),onAccountRefresh:()=>{onAccountRefresh?.();}});
    window.addEventListener("pagehide",stop); window.addEventListener("popstate",stop);
    return ()=>{stop();window.removeEventListener("pagehide",stop);window.removeEventListener("popstate",stop);};
  },[refresh,onAccountRefresh]);
  async function open(action:'checkout'|'portal'){if(inFlight.current)return;inFlight.current=true;setBusy(true);setError(false);try{window.location.assign(await requestBilling(action));}catch{inFlight.current=false;setBusy(false);setError(true);}}
  return <BillingContent status={status} error={error} busy={busy} phase={phase} onSubscribe={()=>{void open('checkout');}} onManage={()=>{void open('portal');}} onRetry={()=>{setError(false);setRefresh(x=>x+1);}}/>;
}
