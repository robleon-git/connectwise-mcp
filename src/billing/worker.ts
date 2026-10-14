import type { BillingService } from "./service.js";
/** Only started after explicit nonproduction TEST opt-in. Receipts/leases survive shutdown. */
export function billingWorker(service:Pick<BillingService,"drain">,report:()=>void=()=>console.error(JSON.stringify({event:'billing.retry_pending'}))){
  let running:Promise<void>|undefined,stopped=false;
  const tick=()=>{if(stopped||running)return running??Promise.resolve();running=service.drain().then(()=>{}).catch(()=>report()).finally(()=>{running=undefined;});return running;};
  const timer=setInterval(()=>{void tick();},5000);timer.unref();
  return {tick,stop:async()=>{stopped=true;clearInterval(timer);await running;}};
}
