import { customerSecretGetAttempt } from "./customer-evidence.js";
import { ManagedIdentityCredential, logger as identityLogger } from "@azure/identity";
import { SecretClient, logger as secretLogger } from "@azure/keyvault-secrets";
import { CUSTOMER_VAULT_URI, validReference } from "../connections/vault.js";
import { CustomerAccessError, type CredentialReader } from "./customer-access.js";
/** Exact version GET only; no listing, metadata lookup, latest-version fallback or pilot vault. */
export function customerCredentialReader(client: Pick<SecretClient, "getSecret">): CredentialReader {
  return { async read(connection) {
    try {
      if (!validReference(connection.connectionId,"publicKey",connection.publicRef) || !validReference(connection.connectionId,"privateKey",connection.privateRef)) throw new Error();
      const read = async (ref: string) => {
        const [,name,version] = new URL(ref).pathname.split("/").slice(1);
        customerSecretGetAttempt();
        const result = await client.getSecret(name,{version,abortSignal:AbortSignal.timeout(10000)});
        if (!result.value) throw new Error();
        return result.value;
      };
      const publicKey = await read(connection.publicRef), privateKey = await read(connection.privateRef);
      return {publicKey,privateKey};
    } catch { throw new CustomerAccessError("service_unavailable"); }
  }};
}
export function managedCustomerCredentialReader(): CredentialReader {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new CustomerAccessError("service_unavailable");
  for (const logger of [identityLogger,secretLogger]) for (const level of ["error","warning","info","verbose"] as const) logger[level].log=()=>{};
  const credential = new ManagedIdentityCredential({loggingOptions:{allowLoggingAccountIdentifiers:false,enableUnsafeSupportLogging:false}});
  return customerCredentialReader(new SecretClient(CUSTOMER_VAULT_URI,credential,{retryOptions:{maxRetries:0},redirectOptions:{handleRedirects:false,maxRetries:0}}));
}
