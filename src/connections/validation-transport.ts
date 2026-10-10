import { Agent, fetch as undiciFetch } from "undici";
import { CwManageClient } from "../api-client.js";
import { ApiRequestError } from "../diagnostics.js";
import { pinnedLookup, resolveAddresses, type Resolver } from "../security/outbound-target.js";
import { ConnectionError, type ConnectionFailure } from "./errors.js";
export const GLOBAL_CLIENT_ID = "241218b8-34d4-4eb0-9d48-244ec0fc7669";
export interface ConnectionInput { baseUrl:string; hostname:string; companyId:string; publicKey:string; privateKey:string }
function networkCategory(error: unknown): ConnectionFailure {
  const e = error as { code?:string;cause?:{code?:string} };
  const code = e?.cause?.code || e?.code || "";
  return /^(?:CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT)/.test(code) ? "tls_failure" : "unreachable_host";
}
export async function runValidation(input: ConnectionInput, dispatchClient:(client:CwManageClient,transport:typeof fetch)=>Promise<void>, resolve: Resolver = resolveAddresses, send: typeof undiciFetch = undiciFetch) {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
  let agent: Agent | undefined, failure: ConnectionFailure | undefined;
  let attempted=false;
  try {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new ConnectionError("tls_failure");
    const lookup = await pinnedLookup(input.hostname,resolve,controller.signal);
    agent = new Agent({connect:{lookup,rejectUnauthorized:true,timeout:5000},headersTimeout:8000,bodyTimeout:8000});
    const requestFailed=new Error("connection_validation_failed");
    const transport = (async (url: string | URL | Request, options?: RequestInit) => {
      try {
        const target=new URL(String(url));
        if(attempted||options?.method!=="GET"||target.protocol!=="https:"||target.hostname.replace(/^\[|\]$/g,"")!==input.hostname||target.port||target.username||target.password||target.search||target.hash||target.pathname!=="/v4_6_release/apis/3.0/system/info"){
          failure="connectwise_rejected";throw requestFailed;
        }
        attempted=true;
        const response = await send(String(url),{...options,dispatcher:agent,signal:controller.signal,redirect:"error"});
        await response.body?.cancel(); // Never parse, retain or return any ConnectWise response body.
        if (response.status === 200 && !/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get("content-type") || "")) {
          failure = "connectwise_rejected"; throw new Error();
        }
        if (response.status !== 200) { failure = response.status === 401 || response.status === 403 ? "authentication_failed" : "connectwise_rejected"; }
        // The existing client consumes JSON. Substitute an empty safe object after disposing the original body.
        return new Response(response.status === 200 ? "{}" : null,{status:response.status});
      } catch (error) { failure ??= networkCategory(error); throw requestFailed; }
    }) as typeof fetch;
    const client = new CwManageClient({baseUrl:input.baseUrl,companyId:input.companyId,publicKey:input.publicKey,privateKey:input.privateKey,
      clientId:GLOBAL_CLIENT_ID,rejectUnauthorized:true});
    await dispatchClient(client,transport);
    if (failure) throw new ConnectionError(failure);
  } catch (error) {
    if (error instanceof ConnectionError) throw error;
    if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) failure = "authentication_failed";
    throw new ConnectionError(failure || "unreachable_host");
  } finally { clearTimeout(timer); controller.abort(); await agent?.destroy(); }
}
