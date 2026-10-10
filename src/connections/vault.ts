import { ManagedIdentityCredential, logger as identityLogger } from "@azure/identity";
import { SecretClient, logger as secretLogger } from "@azure/keyvault-secrets";
import { UUID } from "../control-plane/auth/identity.js";
import { ConnectionError } from "./errors.js";
export const CUSTOMER_VAULT_URI = "https://monotorr-cw-creds-kv.vault.azure.net";
export function secretNames(id:string) {
  if (!UUID.test(id)) throw new ConnectionError("storage_unavailable",503);
  return {publicKey:`cw-connection-${id.toLowerCase()}-public`,privateKey:`cw-connection-${id.toLowerCase()}-private`};
}
export function validReference(id:string,kind:"publicKey"|"privateKey",ref:string) {
  return new RegExp(`^${CUSTOMER_VAULT_URI.replaceAll(".","\\.")}/secrets/${secretNames(id)[kind]}/[a-f0-9]{32}$`).test(ref);
}
export interface CredentialWriter {
  write(id:string,publicKey:string,privateKey:string):Promise<{publicRef:string;privateRef:string}>;
  cleanup(id:string):Promise<void>;
}
export type VaultClient = Pick<SecretClient,"setSecret"> & {deleteSecret(name:string,signal:AbortSignal):Promise<void>};
export function vaultWriter(client:VaultClient):CredentialWriter {
  return {
    async write(id,publicKey,privateKey) {
      try {
        const names=secretNames(id);
        const publicSecret=await client.setSecret(names.publicKey,publicKey,{abortSignal:AbortSignal.timeout(10000)});
        const privateSecret=await client.setSecret(names.privateKey,privateKey,{abortSignal:AbortSignal.timeout(10000)});
        const publicRef=publicSecret.properties.id, privateRef=privateSecret.properties.id;
        if (!publicRef || !privateRef || !validReference(id,"publicKey",publicRef) || !validReference(id,"privateKey",privateRef)) throw new Error();
        return {publicRef,privateRef};
      } catch { throw new ConnectionError("storage_unavailable",503); }
    },
    async cleanup(id) {
      const names=secretNames(id);
      // Try both names even if one cleanup fails. No purge/recover or value-read operation.
      const results=await Promise.allSettled(Object.values(names).map(async name=>{
        const cleanupFailed=new Error("credential_cleanup_failed");
        try { const signal=AbortSignal.timeout(10000); await client.deleteSecret(name,signal); }
        catch(error) { if ((error as {statusCode?:number})?.statusCode !== 404) throw cleanupFailed; }
      }));
      if(results.some(r=>r.status==="rejected")) throw new ConnectionError("storage_unavailable",503);
    }
  };
}
export function managedCredentialWriter() {
  // Dedicated customer vault only; no fallback to cw-mcp-kv, env keys or local credential chains.
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new ConnectionError("storage_unavailable",503);
  for(const logger of [identityLogger,secretLogger])for(const level of ["error","warning","info","verbose"] as const)logger[level].log=()=>{};
  const credential=new ManagedIdentityCredential({loggingOptions:{logger:identityLogger.info,allowLoggingAccountIdentifiers:false,enableUnsafeSupportLogging:false}});
  const client=new SecretClient(CUSTOMER_VAULT_URI,credential,{retryOptions:{maxRetries:0},redirectOptions:{handleRedirects:false,maxRetries:0}});
  return vaultWriter({setSecret:client.setSecret.bind(client),deleteSecret:deleteOnly(credential)});
}

// The SDK delete poller performs getDeletedSecret (value-read). Use the documented DELETE only.
export function deleteOnly(credential:Pick<ManagedIdentityCredential,"getToken">,send:typeof fetch=fetch) {
  return async(name:string,signal:AbortSignal)=>{
    const failure=new ConnectionError("storage_unavailable",503);
    try {
      if(!/^cw-connection-[a-f0-9-]{36}-(?:public|private)$/.test(name)||process.env.NODE_TLS_REJECT_UNAUTHORIZED==="0")throw failure;
      const token=await credential.getToken("https://vault.azure.net/.default",{abortSignal:signal});
      if(!token)throw failure;
      const response=await send(`${CUSTOMER_VAULT_URI}/secrets/${name}?api-version=2025-07-01`,{method:"DELETE",redirect:"error",signal,headers:{Authorization:`Bearer ${token.token}`}});
      await response.body?.cancel();
      if(response.status!==200&&response.status!==404)throw failure;
    } catch {throw failure;}
  };
}
