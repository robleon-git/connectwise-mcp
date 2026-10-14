import {it,describe,expect,vi,afterEach} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const path='../../portal/src/Billing.tsx';const {BillingContent,parseBillingStatus,requestBilling,refreshBillingStatus}=await import(path);
const status={enabled:true,canSubscribe:true,canManage:false,state:'trial',priceDisplay:'$29/month'};const noop=()=>{};
const render=(s:unknown=status,extra:Record<string,unknown>={})=>renderToStaticMarkup(createElement(BillingContent,{status:s,busy:false,error:false,onSubscribe:noop,onManage:noop,onRetry:noop,...extra}));
describe('minimal portal billing',()=>{
 it('shows Subscribe for trial or inactive access without replacing entitlement presentation',()=>{for(const state of ['trial','inactive']){const html=render({...status,state});expect(html).toContain('Subscribe — $29/month');expect(html).toContain('current account access is shown above');expect(html).not.toContain('Manage billing');}});
 it('shows Manage billing for paid and retryable states',()=>{for(const state of ['active','payment_attention']){const html=render({...status,state,canSubscribe:false,canManage:true});expect(html).toContain('Manage billing');expect(html).not.toContain('Subscribe —');expect(html).not.toContain('Access canceled');}});
 it('shows truthful pending state and keeps canceled resubscription independent of trial',()=>{expect(render({...status,state:'pending',canSubscribe:false,canManage:true})).toContain('awaiting confirmation');expect(render({...status,state:'trial',canManage:true})).toContain('Subscribe — $29/month');});
 it('hides disabled/unknown billing and supports accessible retry/loading',()=>{expect(render(null)).toBe('');expect(render({...status,enabled:false})).toBe('');expect(render(status,{busy:true})).toContain('disabled=""');expect(render(status,{busy:true})).toContain('Opening billing');expect(render(status,{error:true})).toContain('role="alert"');});
 it('never displays raw sources, provider IDs or statuses',()=>{for(const state of ['trial','active','payment_attention','inactive','pending'])expect(render({...status,state})).not.toMatch(/web_paid|past_due|comp|substack|cus_|sub_|price_|prod_/);});
 it('sanitizes status responses to the approved contract',()=>{expect(parseBillingStatus({...status,customer:'cus_private',source:'web_paid'})).toEqual(status);for(const x of [{},null,{...status,state:'past_due'},{...status,canSubscribe:'true'},{...status,priceDisplay:'$299/month'}])expect(()=>parseBillingStatus(x)).toThrow();});
 it.each(['checkout','portal'] as const)('uses a credentialed bounded %s POST with no account hints',async action=>{const url=action==='checkout'?'https://checkout.stripe.com/c/pay/cs_test_fixture':'https://billing.stripe.com/p/session/test_fixture';const send=vi.fn(async()=>Response.json({url}));expect(await requestBilling(action,send)).toBe(url);expect(send).toHaveBeenCalledWith('https://api.monotorr.com/connectwise/v1/billing/'+action,{method:'POST',credentials:'include',redirect:'error',headers:{'Content-Type':'application/json'},body:'{}'});});
 it('rejects open redirects, malformed URLs and server failures',async()=>{for(const url of ['http://checkout.stripe.com/test','https://evil.example','https://checkout.stripe.com.evil.example','https://user:secret@billing.stripe.com/session','https://billing.stripe.com:9443/session','javascript:alert(1)'])await expect(requestBilling('checkout',async()=>Response.json({url}))).rejects.toThrow();await expect(requestBilling('portal',async()=>new Response('',{status:503}))).rejects.toThrow();});
});

const paid={...status,state:'active',canSubscribe:false,canManage:true};
describe('bounded Checkout return refresh',()=>{
 afterEach(()=>vi.useRealTimers());
 function observer(send:typeof fetch,checkoutReturn=true){const onStatus=vi.fn(),onPhase=vi.fn(),onAccountRefresh=vi.fn(),onError=vi.fn();const stop=refreshBillingStatus({send,checkoutReturn,onStatus,onPhase,onAccountRefresh,onError});return {stop,onStatus,onPhase,onAccountRefresh,onError};}
 it('updates from delayed reconciliation and refreshes account only after authoritative billing responses',async()=>{
  vi.useFakeTimers();const send=vi.fn().mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json(status)).mockResolvedValueOnce(Response.json(paid));const o=observer(send);
  expect(o.onAccountRefresh).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(0);expect(o.onStatus).toHaveBeenLastCalledWith(status);expect(o.onAccountRefresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2500);expect(o.onAccountRefresh).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(2500);expect(o.onStatus).toHaveBeenLastCalledWith(paid);expect(o.onAccountRefresh).toHaveBeenCalledTimes(2);expect(o.onPhase).toHaveBeenLastCalledWith('idle');await vi.advanceTimersByTimeAsync(30000);expect(send).toHaveBeenCalledTimes(3);o.stop();
 });
 it('expires after eight GETs and renders truthful manual Refresh without inferring paid access',async()=>{
  vi.useFakeTimers();const send=vi.fn(async()=>Response.json(status));const o=observer(send);await vi.advanceTimersByTimeAsync(30000);expect(send).toHaveBeenCalledTimes(8);expect(o.onPhase).toHaveBeenLastCalledWith('exhausted');expect(o.onStatus.mock.calls.every(([s])=>s.state==='trial')).toBe(true);
  const html=render(status,{phase:'exhausted'});expect(html).toContain('confirmation is still pending');expect(html).toContain('>Refresh</button>');expect(html).not.toContain('subscription is active');expect(html).toContain('disabled=""');o.stop();
 });
 it('manual Refresh starts a fresh bounded read and can observe confirmation',async()=>{
  vi.useFakeTimers();const send=vi.fn(async()=>Response.json(status));const first=observer(send);await vi.advanceTimersByTimeAsync(30000);first.stop();send.mockResolvedValueOnce(Response.json(paid));const second=observer(send);await vi.advanceTimersByTimeAsync(0);expect(second.onStatus).toHaveBeenLastCalledWith(paid);expect(second.onPhase).toHaveBeenLastCalledWith('idle');second.stop();
 });
 it('cleanup aborts in-flight fetch, ignores late responses and removes scheduled polling',async()=>{
  vi.useFakeTimers();let release:(r:Response)=>void=()=>{};const send=vi.fn((_url:unknown,_init?:RequestInit)=>new Promise<Response>(r=>{release=r;}));const o=observer(send);o.stop();expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);release(Response.json(paid));await vi.advanceTimersByTimeAsync(60000);expect(o.onStatus).not.toHaveBeenCalled();expect(o.onAccountRefresh).not.toHaveBeenCalled();expect(send).toHaveBeenCalledTimes(1);
  const settled=vi.fn(async()=>Response.json(status));const next=observer(settled);await vi.advanceTimersByTimeAsync(0);next.stop();await vi.advanceTimersByTimeAsync(60000);expect(settled).toHaveBeenCalledTimes(1);
 });
 it('a stalled request hits the thirty-second deadline with no activation',async()=>{
  vi.useFakeTimers();const send=vi.fn((_url:unknown,_init?:RequestInit)=>new Promise<Response>(()=>{}));const o=observer(send);await vi.advanceTimersByTimeAsync(30000);expect(o.onPhase).toHaveBeenLastCalledWith('exhausted');expect(send.mock.calls[0][1]?.signal?.aborted).toBe(true);expect(o.onStatus).not.toHaveBeenCalled();expect(o.onAccountRefresh).not.toHaveBeenCalled();o.stop();
 });
 it('the return flag performs credentialed GETs only; missing/off or denied responses cannot grant access',async()=>{
  vi.useFakeTimers();const send=vi.fn(async()=>new Response('{}',{status:404}));const o=observer(send);await vi.advanceTimersByTimeAsync(0);expect(o.onStatus).toHaveBeenCalledWith(null);expect(o.onAccountRefresh).not.toHaveBeenCalled();expect(o.onPhase).toHaveBeenLastCalledWith('idle');expect((send.mock.calls[0] as unknown as [string,RequestInit])[0]).toBe('https://api.monotorr.com/connectwise/v1/billing/status');const init=(send.mock.calls[0] as unknown as [string,RequestInit])[1];expect(init).toMatchObject({credentials:'include',redirect:'error'});expect(init.method).toBeUndefined();o.stop();
  const denied=observer(vi.fn(async()=>new Response('{}',{status:401})));await vi.advanceTimersByTimeAsync(30000);expect(denied.onStatus).not.toHaveBeenCalled();expect(denied.onAccountRefresh).not.toHaveBeenCalled();denied.stop();
 });
 it('preserves ordinary single-fetch behavior and sanitized retry on non-return errors',async()=>{
  vi.useFakeTimers();const send=vi.fn(async()=>Response.json(status));const o=observer(send,false);await vi.advanceTimersByTimeAsync(30000);expect(send).toHaveBeenCalledTimes(1);expect(o.onAccountRefresh).not.toHaveBeenCalled();o.stop();const failed=observer(vi.fn(async()=>new Response('{}',{status:503})),false);await vi.advanceTimersByTimeAsync(0);expect(failed.onError).toHaveBeenCalledTimes(1);expect(failed.onPhase).toHaveBeenLastCalledWith('idle');failed.stop();
 });
});
