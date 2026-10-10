export const PORTAL_ORIGIN = "https://portal.monotorr.com";
export const API_ORIGIN = "https://api.monotorr.com";
export const API_PREFIX = "/connectwise/v1";
export const CALLBACK_URI = `${API_ORIGIN}${API_PREFIX}/auth/callback`;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class CustomerAuthError extends Error {
  constructor() { super("customer_auth_failed"); }
}
export interface MicrosoftIdentity { tenantId: string; objectId: string; name?: string; email?: string }
export function organizationalIdentity(claims: Record<string, unknown>): MicrosoftIdentity {
  const tid = claims.tid, oid = claims.oid;
  if (typeof tid !== "string" || !UUID.test(tid) || typeof oid !== "string" || !UUID.test(oid) ||
      tid.toLowerCase() === "9188040d-6c67-4c5b-b112-36a304b66dad" ||
      claims.iss !== `https://login.microsoftonline.com/${tid}/v2.0` || claims.ver !== "2.0" || claims.idtyp === "app" || claims.idp === "live.com")
    throw new CustomerAuthError();
  const profile = (value: unknown) => typeof value === "string" && value.length <= 256 ? value : undefined;
  return { tenantId: tid.toLowerCase(), objectId: oid.toLowerCase(), name: profile(claims.name), email: profile(claims.email) };
}
