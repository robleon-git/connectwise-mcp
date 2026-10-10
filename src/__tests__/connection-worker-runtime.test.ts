import {describe,it,expect,vi} from 'vitest';
import type {ConnectionInput} from '../connections/validation-transport.js';
const compiledModule='../../dist/connections/validation.js';
const {validateConnection}=await import(compiledModule) as {validateConnection(input:ConnectionInput):Promise<void>};
describe('actual compiled control validation workers',()=>{
 it('rejects blocked destinations in isolated compiled workers without outbound requests or leaked output',async()=>{
  const mainFetch=globalThis.fetch,log=vi.spyOn(console,'log').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{});
  const input={baseUrl:'https://127.0.0.1',hostname:'127.0.0.1',companyId:'synthetic',publicKey:'synthetic-public',privateKey:'synthetic-private'};
  try {
   const results=await Promise.allSettled([validateConnection(input),validateConnection(input)]);
   for(const result of results){expect(result.status).toBe('rejected');if(result.status==='rejected')expect(result.reason.message).toBe('unsafe_destination');}
   expect(globalThis.fetch).toBe(mainFetch);expect(log).not.toHaveBeenCalled();expect(error).not.toHaveBeenCalled();
  }finally{log.mockRestore();error.mockRestore();}
 });
});
