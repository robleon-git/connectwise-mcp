import { pathToFileURL } from "node:url";
export async function customerSmoke(fetcher = fetch) {
  const base = "https://api.monotorr.com/connectwise/v1";
  const response = await fetcher(base + "/account/status", { redirect: "error", signal: AbortSignal.timeout(10000), headers: { Origin: "https://portal.monotorr.com" } });
  if (response.status !== 401 || response.headers.get("Access-Control-Allow-Origin") !== "https://portal.monotorr.com" ||
      response.headers.get("Access-Control-Allow-Credentials") !== "true") throw new Error("customer_smoke_failed");
  await response.body?.cancel();
  const login = await fetcher(base + "/auth/login", { redirect: "manual", signal: AbortSignal.timeout(10000) });
  const location = new URL(login.headers.get("Location") || "https://invalid.example");
  if (login.status !== 302 || location.origin !== "https://login.microsoftonline.com" ||
      location.pathname !== "/organizations/oauth2/v2.0/authorize" || location.searchParams.get("redirect_uri") !== base + "/auth/callback" ||
      location.searchParams.get("client_id") !== "4405ef16-dc89-4385-8a84-cda2a52274cf" ||
      location.searchParams.get("code_challenge_method") !== "S256" || location.searchParams.get("scope") !== "openid profile email" ||
      !login.headers.get("Set-Cookie")?.includes("HttpOnly")) throw new Error("customer_smoke_failed");
  await login.body?.cancel();
  return { customerAnonymousDenied: true, customerCorsMatched: true, microsoftLoginStarted: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await customerSmoke())); }
  catch { console.error(JSON.stringify({ customerSmokePassed: false })); process.exitCode = 1; }
}
