import { randomUUID } from "node:crypto";
import { managedCustomerCredentialReader } from "../auth/customer-vault.js";
import type { CredentialReader } from "../auth/customer-access.js";
import { z } from "zod";
import type { CustomerContext } from "../control-plane/auth/store.js";
import { normalizeTarget } from "../security/outbound-target.js";
import { ConnectionError } from "./errors.js";
import { validateConnection, type ConnectionInput } from "./validation.js";
import { ConnectionStore, type SavedConnection } from "./store.js";
import { managedCredentialWriter, validReference, type CredentialWriter } from "./vault.js";
const fields=z.object({url:z.string().min(1).max(2048),companyId:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  publicKey:z.string().regex(/^[A-Za-z0-9+/_=-]{1,512}$/),privateKey:z.string().regex(/^[A-Za-z0-9+/_=-]{1,512}$/)}).strict();
export function connectionInput(body:unknown):ConnectionInput {
  const result=fields.safeParse(body);if(!result.success)throw new ConnectionError("invalid_input");
  const {url,...credentials}=result.data;return {...normalizeTarget(url),...credentials};
}
export class ConnectionService {
  constructor(private readonly store:ConnectionStore,private readonly writer:()=>CredentialWriter=managedCredentialWriter,
    private readonly validate:(input:ConnectionInput)=>Promise<void>=validateConnection,
    private readonly reader:()=>CredentialReader=managedCustomerCredentialReader) {}
  status(context:CustomerContext) {return this.store.status(context);}
  private async credentials(context:CustomerContext,row:SavedConnection) {
    if(!validReference(row.id,"publicKey",row.public_secret_ref)||!validReference(row.id,"privateKey",row.private_secret_ref))throw new ConnectionError("storage_unavailable",503);
    try {return await this.reader().read({userId:context.userId,accountId:context.accountId,connectionId:row.id,baseUrl:row.server_url,companyId:row.company_id,publicRef:row.public_secret_ref,privateRef:row.private_secret_ref});}
    catch {throw new ConnectionError("storage_unavailable",503);}
  }
  async test(context:CustomerContext) {
    await this.store.test(context,async row=>{
      const keys=await this.credentials(context,row);
      try {await this.validate(connectionInput({url:row.server_url,companyId:row.company_id,...keys}));}
      finally {keys.publicKey="";keys.privateKey="";}
    });return {status:"successful" as const};
  }
  private async cleanup(id:string) {
    try {await this.writer().cleanup(id);}catch {console.error(JSON.stringify({event:"connection.cleanup_required",connectionId:id}));}
  }
  async edit(context:CustomerContext,body:unknown) {
    const parsed=fields.extend({publicKey:fields.shape.publicKey.optional(),privateKey:fields.shape.privateKey.optional()}).safeParse(body);
    if(!parsed.success || !!parsed.data.publicKey!==!!parsed.data.privateKey)throw new ConnectionError("invalid_input");
    const target=normalizeTarget(parsed.data.url),id=randomUUID();let previous:string|undefined;let writeAttempted=false;
    try {
      previous=await this.store.replace(context,id,{baseUrl:target.baseUrl,companyId:parsed.data.companyId},async(row,check)=>{
        previous=row.id;
        const keys=parsed.data.publicKey&&parsed.data.privateKey ? {publicKey:parsed.data.publicKey,privateKey:parsed.data.privateKey} : await this.credentials(context,row);
        try {
          await this.validate(connectionInput({url:target.baseUrl,companyId:parsed.data.companyId,...keys}));await check();
          writeAttempted=true;const refs=await this.writer().write(id,keys.publicKey,keys.privateKey);
          if(!validReference(id,"publicKey",refs.publicRef)||!validReference(id,"privateKey",refs.privateRef))throw new ConnectionError("storage_unavailable",503);
          return refs;
        } finally {keys.publicKey="";keys.privateKey="";parsed.data.publicKey=undefined;parsed.data.privateKey=undefined;}
      });
    } catch(error) {
      if(!writeAttempted){if(error instanceof ConnectionError)throw error;throw new ConnectionError("storage_unavailable",503);}
      // A lost COMMIT acknowledgement must never delete credentials that may have become active.
      let current:string|null;try {current=await this.store.activeId(context);}catch {throw new ConnectionError("storage_unavailable",503);}
      if(current!==id){if(writeAttempted)await this.cleanup(id);if(error instanceof ConnectionError)throw error;throw new ConnectionError("storage_unavailable",503);}
    }
    if(previous)await this.cleanup(previous);return {status:"connected" as const};
  }
  async disconnect(context:CustomerContext) {
    const id=await this.store.disconnect(context);await this.cleanup(id);return {status:"not_configured" as const};
  }
  async setup(context:CustomerContext,body:unknown) {
    const input=connectionInput(body);
    // Reserve checks entitlement/ownership before validation or any vault operation.
    const reservation=await this.store.reserve(context,{baseUrl:input.baseUrl,companyId:input.companyId},()=>this.validate(input),id=>this.writer().cleanup(id));
    const unavailable=new ConnectionError("storage_unavailable",503);
    let refs:{publicRef:string;privateRef:string}|undefined;
    try {
      refs=await this.writer().write(reservation.id,input.publicKey,input.privateKey);
      if(!validReference(reservation.id,"publicKey",refs.publicRef)||!validReference(reservation.id,"privateKey",refs.privateRef))throw new Error();
      await this.store.activate(context,reservation.id,refs);
    } catch(error) {
      try {
        const state=await this.store.cleanupState(context,reservation.id);
        if(typeof state==='object') {
          if(refs&&state.public_secret_ref===refs.publicRef&&state.private_secret_ref===refs.privateRef) return {status:"connected" as const};
          throw unavailable; // Unknown committed state: do not delete possibly active credentials.
        }
        await this.writer().cleanup(reservation.id);
        await this.store.removePending(context,reservation.id);
      } catch { // Durable pending locator remains; a later entitled setup reclaims stale/nonactive attempts.
        console.error(JSON.stringify({event:"connection.cleanup_required",connectionId:reservation.id}));
      }
      if(error instanceof ConnectionError)throw error;throw unavailable;
    }
    return {status:"connected" as const};
  }
}
