import { z } from "zod";
import type { CustomerContext } from "../control-plane/auth/store.js";
import { normalizeTarget } from "../security/outbound-target.js";
import { ConnectionError } from "./errors.js";
import { validateConnection, type ConnectionInput } from "./validation.js";
import { ConnectionStore } from "./store.js";
import { managedCredentialWriter, validReference, type CredentialWriter } from "./vault.js";
const fields=z.object({url:z.string().min(1).max(2048),companyId:z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
  publicKey:z.string().regex(/^[A-Za-z0-9+/_=-]{1,512}$/),privateKey:z.string().regex(/^[A-Za-z0-9+/_=-]{1,512}$/)}).strict();
export function connectionInput(body:unknown):ConnectionInput {
  const result=fields.safeParse(body);if(!result.success)throw new ConnectionError("invalid_input");
  const {url,...credentials}=result.data;return {...normalizeTarget(url),...credentials};
}
export class ConnectionService {
  constructor(private readonly store:ConnectionStore,private readonly writer:()=>CredentialWriter=managedCredentialWriter,
    private readonly validate:(input:ConnectionInput)=>Promise<void>=validateConnection) {}
  status(context:CustomerContext) {return this.store.status(context);}
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
