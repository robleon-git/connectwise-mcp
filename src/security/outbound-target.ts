import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { lookup as nodeLookup } from "node:dns";
import { ConnectionError } from "../connections/errors.js";
const blocked4 = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.88.99.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const) blocked4.addSubnet(address, prefix, "ipv4");
blocked4.addAddress("168.63.129.16", "ipv4"); // Azure platform virtual IP, never a customer destination.
const global6 = new BlockList(); global6.addSubnet("2000::",3,"ipv6");
const blocked6 = new BlockList();
for (const [address,prefix] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]] as const) blocked6.addSubnet(address,prefix,"ipv6");
export function publicAddress(address: string, family: number) {
  if (isIP(address) !== family) return false;
  return family === 4 ? !blocked4.check(address,"ipv4") : family === 6 && global6.check(address,"ipv6") && !blocked6.check(address,"ipv6");
}
export function normalizeTarget(input: string) {
  try {
    if (input !== input.trim() || input.length > 2048 || /[\\\s]/.test(input)) throw new Error();
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port ||
        !["/","/v4_6_release/apis/3.0","/v4_6_release/apis/3.0/"].includes(url.pathname)) throw new Error();
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname)) { if (!publicAddress(hostname,isIP(hostname))) throw new ConnectionError("unsafe_destination"); }
    else if (hostname.length > 253 || hostname.endsWith(".") || !hostname.includes(".") ||
        !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(hostname)) throw new ConnectionError("unsafe_destination");
    return { baseUrl: url.origin + (url.pathname === "/" ? "" : "/v4_6_release/apis/3.0"), hostname };
  } catch (error) { if (error instanceof ConnectionError) throw error; throw new ConnectionError("invalid_url"); }
}
export type Resolver = (hostname: string) => Promise<{address:string;family:number}[]>;
export const resolveAddresses: Resolver = hostname => lookup(hostname,{all:true,verbatim:true});
export async function pinnedLookup(hostname: string, resolve: Resolver, signal: AbortSignal) {
  const addresses = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await new Promise<Awaited<ReturnType<Resolver>>>((accept,reject) => {
    const abort = () => reject(new ConnectionError("unreachable_host"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort",abort,{once:true});
    resolve(hostname).then(accept,()=>reject(new ConnectionError("unreachable_host"))).finally(()=>signal.removeEventListener("abort",abort));
  });
  if (!addresses.length || addresses.some(a=>!publicAddress(a.address,a.family))) throw new ConnectionError("unsafe_destination");
  // No second DNS lookup: TCP uses the already checked address while TLS retains the original hostname.
  const selected = addresses[0];
  return ((host: string, options: {all?:boolean}, callback: (...args: unknown[])=>void) => {
    if (host !== hostname) { callback(new Error("unsafe_destination")); return; }
    if (options.all) callback(null,[selected]); else callback(null,selected.address,selected.family);
  }) as unknown as typeof nodeLookup;
}
