import { connectWiseGetAttempt } from "./customer-evidence.js";
import { Agent, fetch as undiciFetch } from "undici";
import { normalizeTarget, pinnedLookup, resolveAddresses, type Resolver } from "../security/outbound-target.js";
/** One request-scoped transport, with no global fetch/dispatcher mutation. TLS retains original hostname. */
export function customerTransport(baseUrl: string, resolve: Resolver = resolveAddresses, send: typeof undiciFetch = undiciFetch) {
  const target = normalizeTarget(baseUrl);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let agent: Agent | undefined, pending: Promise<Agent> | undefined;
  const connect = () => pending ??= (async () => {
    if (controller.signal.aborted || process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error();
    timer = setTimeout(()=>controller.abort(),30000);
    const lookup = await pinnedLookup(target.hostname,resolve,controller.signal);
    if (controller.signal.aborted) throw new Error();
    agent = new Agent({connect:{lookup,rejectUnauthorized:true,timeout:5000},headersTimeout:10000,bodyTimeout:10000});
    return agent;
  })();
  const transport = (async (input: string | URL | Request, options?: RequestInit) => {
    try {
      const url = new URL(String(input));
      if (options?.method !== "GET" || options.body !== undefined || url.protocol !== "https:" ||
          url.origin !== new URL(target.baseUrl).origin || url.username || url.password || url.hash ||
          !url.pathname.startsWith("/v4_6_release/apis/3.0/")) throw new Error();
      const dispatcher = await connect();
      connectWiseGetAttempt();
      return await send(url.href,{...options,dispatcher,redirect:"error",signal:controller.signal});
    } catch { throw new Error("connectwise_transport_failed"); }
  }) as typeof fetch;
  return {transport,close:async()=>{clearTimeout(timer);controller.abort();await pending?.catch(()=>{});await agent?.destroy();}};
}
