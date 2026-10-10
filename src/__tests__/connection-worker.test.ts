import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
const mocks=vi.hoisted(()=>({event:'message',message:{ok:true} as unknown,terminate:vi.fn(async()=>0),construct:vi.fn()}));
vi.mock('node:worker_threads',()=>({Worker:class extends EventEmitter{
 stdout=new PassThrough();stderr=new PassThrough();terminate=mocks.terminate;
 constructor(url:URL,options:unknown){super();mocks.construct(url,options);queueMicrotask(()=>{
  this.stdout.write('synthetic-private-canary');this.stderr.write('synthetic-private-canary');
  if(mocks.event!=='stalled')this.emit(mocks.event,mocks.message);
 });}
}}));
import {validateConnection} from '../connections/validation.js';
const input={baseUrl:'https://manage.example.com',hostname:'manage.example.com',companyId:'synthetic-company',publicKey:'synthetic-public-canary',privateKey:'synthetic-private-canary'};
beforeEach(()=>{vi.clearAllMocks();mocks.event='message';mocks.message={ok:true};});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
describe('control-only validation worker boundary',()=>{
 it('passes credentials only in memory and never changes main-thread fetch',async()=>{
  const mainFetch=globalThis.fetch,log=vi.spyOn(console,'log').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
  await expect(validateConnection(input)).resolves.toBeUndefined();
  expect(globalThis.fetch).toBe(mainFetch);expect(mocks.construct).toHaveBeenCalledWith(expect.any(URL),{workerData:input,stdout:true,stderr:true});
  expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();expect(mocks.terminate).toHaveBeenCalledOnce();
 });
 it.each([{ok:true,privateKey:input.privateKey},{ok:false,code:input.privateKey},{ok:false,code:'tls_failure',body:input.privateKey},input.privateKey,null])('rejects arbitrary worker payloads without reflecting them',async message=>{
  mocks.message=message;await expect(validateConnection(input)).rejects.toThrow(/^unreachable_host$/);expect(mocks.terminate).toHaveBeenCalledOnce();
 });
 it.each(['unsafe_destination','tls_failure','authentication_failed','connectwise_rejected'])('allows only sanitized category %s',async code=>{
  mocks.message={ok:false,code};await expect(validateConnection(input)).rejects.toThrow(new RegExp(`^${code}$`));
 });
 it('does not relay raw worker exceptions',async()=>{
  mocks.event='error';mocks.message=new Error(input.privateKey);await expect(validateConnection(input)).rejects.toThrow(/^unreachable_host$/);
 });
 it('terminates a stalled worker within the total deadline',async()=>{
  vi.useFakeTimers();mocks.event='stalled';const check=expect(validateConnection(input)).rejects.toThrow(/^unreachable_host$/);
  await vi.advanceTimersByTimeAsync(10001);await check;expect(mocks.terminate).toHaveBeenCalledOnce();
 });
});
