import { Router,json,raw } from "express";
import { PORTAL_ORIGIN } from "../control-plane/auth/identity.js";
import { readCookie,SESSION_COOKIE } from "../control-plane/auth/routes.js";
import type { CustomerStore } from "../control-plane/auth/store.js";
import { BillingError } from "./config.js";
import type { BillingService } from "./service.js";
/** Mounted inside the existing portal-origin router; independently enforces ownership and Origin. */
export function billingCustomerRoutes(customers:Pick<CustomerStore,"session"|"status">,service:BillingService) {
  const r=Router();
  const limits=new Map<string,{count:number;until:number}>();
  r.all(["/billing/status","/billing/checkout","/billing/portal"],async(req,res,next)=>{
    if(Object.keys(req.query).length||["X-Account-Id","X-Customer-Id","X-Subscription-Id"].some(h=>!!req.get(h))){res.status(400).json({error:"invalid_request"});return;}
    if(req.get("Origin")&&req.get("Origin")!==PORTAL_ORIGIN || req.method==='POST'&&req.get("Origin")!==PORTAL_ORIGIN){res.status(403).json({error:"forbidden"});return;}
    try{const context=await customers.session(readCookie(req.get("Cookie"),SESSION_COOKIE));if(!context){res.status(401).json({error:"unauthorized"});return;}if(req.method==='POST'){const now=Date.now();for(const [id,x]of limits)if(x.until<=now)limits.delete(id);let x=limits.get(context.accountId);if(!x){if(limits.size>=1000){res.status(429).json({error:'try_again_later'});return;}x={count:0,until:now+60000};limits.set(context.accountId,x);}if(++x.count>5){res.status(429).json({error:'try_again_later'});return;}}res.locals.billingOwner=context;next();}catch{res.status(503).json({error:"billing_unavailable"});}
  });
  r.get('/billing/status',async(_req,res)=>{try{const owner=res.locals.billingOwner;const status=await customers.status(owner);res.json(await service.status(owner,status.entitlement.accessKind==='trial'&&status.entitlement.allowed));}catch{res.status(503).json({error:"billing_unavailable"});}});
  for(const action of ['checkout','portal'] as const)r.post('/billing/'+action,(req,res)=>{
    if(!req.is('application/json')&&(req.get('Content-Length')&&req.get('Content-Length')!=='0'||req.get('Transfer-Encoding'))){res.status(400).json({error:"invalid_request"});return;}
    json({limit:'1kb',inflate:false,strict:true})(req,res,error=>{
      if(error || req.body!==undefined && (typeof req.body!=='object'||req.body===null||Array.isArray(req.body)||Object.keys(req.body).length)){res.status(400).json({error:"invalid_request"});return;}
      void service[action](res.locals.billingOwner).then(x=>res.json(x)).catch(e=>{const code=e instanceof BillingError?e.category:'billing_unavailable';res.status(code==='setup_required'?404:code==='checkout_pending'?409:code==='invalid_mapping'?403:503).json({error:code==='invalid_mapping'?'forbidden':code==='setup_required'||code==='checkout_pending'?code:'billing_unavailable'});}).finally(()=>{req.body=undefined;});
    });
  });
  r.use((_err:unknown,_req:unknown,res:{status:(n:number)=>{json:(o:unknown)=>void}},_next:unknown)=>{res.status(400).json({error:'invalid_request'});});
  return r;
}
/** Raw bytes are parsed before the portal/session router. No browser cookies authenticate Stripe. */
export function billingWebhookRoutes(service:BillingService){
  const r=Router();r.post('/billing/webhook',raw({type:'application/json',limit:'256kb',inflate:false}),async(req,res)=>{
    try{const signature=req.get('Stripe-Signature');if(!signature||!Buffer.isBuffer(req.body))throw new BillingError('invalid_signature');await service.receiveWebhook(req.body,signature);res.json({received:true});}
    catch(e){res.status(e instanceof BillingError&&e.category==='invalid_signature'?400:503).json({error:e instanceof BillingError&&e.category==='invalid_signature'?'invalid_signature':'billing_unavailable'});}finally{req.body=undefined;}
  });r.use((_err:unknown,_req:unknown,res:{status:(n:number)=>{json:(o:unknown)=>void}},_next:unknown)=>{res.status(400).json({error:'invalid_signature'});});return r;
}
