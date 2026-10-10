// Explicit operator-only setup for the approved Slice 1 registration. Never a workflow step.
import { AzureCliCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import { createClientLogger } from "@azure/logger";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
export const APP_OBJECT_ID = "ac582c04-b7d8-479a-b050-6ff4d32aa1a4";
export const APP_CLIENT_ID = "4405ef16-dc89-4385-8a84-cda2a52274cf";
export const BROWSER_SECRETS = ["cw-portal-oidc-client-secret", "cw-browser-flow-key"];
export async function provisionBrowserAuth(vault, graph, generate = () => randomBytes(32).toString("hex")) {
  let passwordKey;
  try {
    for (const name of BROWSER_SECRETS) if (await vault.exists(name)) throw new Error();
    const password = await graph.addPassword(); passwordKey = password.keyId;
    if (!passwordKey || typeof password.secretText !== "string" || !password.secretText) throw new Error();
    const flowKey = generate(); if (!/^[a-f0-9]{64}$/.test(flowKey)) throw new Error();
    await vault.set(BROWSER_SECRETS[0], password.secretText);
    await vault.set(BROWSER_SECRETS[1], flowKey);
    return { browserAuthSecretsProvisioned: true };
  } catch {
    if (passwordKey) {
      try { await graph.removePassword(passwordKey); }
      catch { throw new Error("browser_credential_cleanup_required"); }
    }
    throw new Error("browser_auth_provisioning_failed");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--approved-slice1") throw new Error();
    for (const area of ["identity", "keyvault-secrets"]) {
      const logger = createClientLogger(area);
      logger.info.log = () => {}; logger.warning.log = () => {}; logger.error.log = () => {};
    }
    const credential = new AzureCliCredential({ loggingOptions: { allowLoggingAccountIdentifiers: false, enableUnsafeSupportLogging: false } });
    const vault = new SecretClient("https://cw-mcp-kv.vault.azure.net", credential, { retryOptions: { maxRetries: 0 }, redirectOptions: { handleRedirects: false, maxRetries: 0 } });
    const request = async (path, body) => {
      const token = await credential.getToken("https://graph.microsoft.com/.default");
      const response = await fetch(`https://graph.microsoft.com/v1.0/applications/${APP_OBJECT_ID}/${path}`, {
        method: "POST", headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(); }
      return response.status === 204 ? undefined : response.json();
    };
    const result = await provisionBrowserAuth({
      exists: async name => {
        try { await vault.getSecret(name, { abortSignal: AbortSignal.timeout(10000) }); return true; }
        catch (e) {
          if (e?.statusCode === 404) return false;
          throw e; // Bounded provisionBrowserAuth wrapper sanitizes this.
        }
      },
      set: async (name, value) => { await vault.setSecret(name, value, { abortSignal: AbortSignal.timeout(10000) }); }
    }, {
      addPassword: () => request("addPassword", { passwordCredential: { displayName: "connectwise-browser-slice1", endDateTime: new Date(Date.now() + 90 * 86400000).toISOString() } }),
      removePassword: keyId => request("removePassword", { keyId })
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ browserAuthSecretsProvisioned: false, reason: error?.message === "browser_credential_cleanup_required" ? "cleanup_required" : "setup_failed" }));
    process.exitCode = 1;
  }
}
