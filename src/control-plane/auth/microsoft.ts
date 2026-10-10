import * as oidc from "openid-client";
import { decodeProtectedHeader } from "jose";
import { createAzureSecretReader } from "../../config-loader.js";
import { CALLBACK_URI, CustomerAuthError, organizationalIdentity, type MicrosoftIdentity, UUID } from "./identity.js";
export interface BrowserFlow { state: string; nonce: string; verifier: string }
export interface IdentityProvider {
  start(flow: BrowserFlow): Promise<string>;
  complete(url: URL, flow: BrowserFlow): Promise<MicrosoftIdentity>;
}
export async function microsoftProvider(env: NodeJS.ProcessEnv): Promise<{ provider: IdentityProvider; flowKey: Uint8Array }> {
  if (!UUID.test(env.CW_PORTAL_LOGIN_CLIENT_ID || "") || env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
      env.CW_KEY_VAULT_URI !== "https://cw-mcp-kv.vault.azure.net") throw new CustomerAuthError();
  const read = await createAzureSecretReader(env.CW_KEY_VAULT_URI, env);
  const secret = await read("cw-portal-oidc-client-secret");
  const flowSecret = await read("cw-browser-flow-key");
  if (!secret || !flowSecret || !/^[a-f0-9]{64}$/.test(flowSecret)) throw new CustomerAuthError();
  const config = await oidc.discovery(new URL("https://login.microsoftonline.com/organizations/v2.0"), env.CW_PORTAL_LOGIN_CLIENT_ID!,
    { client_secret: secret, id_token_signed_response_alg: "RS256" }, oidc.ClientSecretPost(secret),
    { execute: [oidc.enableNonRepudiationChecks], timeout: 10 });
  return { flowKey: Buffer.from(flowSecret, "hex"), provider: providerFromConfig(config) };
}
export function providerFromConfig(config: oidc.Configuration): IdentityProvider {
  return {
    async start(flow) {
      return oidc.buildAuthorizationUrl(config, { redirect_uri: CALLBACK_URI, scope: "openid profile email", response_type: "code",
        code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier), code_challenge_method: "S256", state: flow.state, nonce: flow.nonce }).href;
    },
    async complete(url, flow) {
      try {
        const tokens = await oidc.authorizationCodeGrant(config, url, { pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true });
        const claims = tokens.claims();
        if (!claims || !tokens.id_token) throw new CustomerAuthError();
        const identity = organizationalIdentity(claims);
        // Microsoft signing keys carry issuer restrictions as well as the token itself.
        const header = decodeProtectedHeader(tokens.id_token);
        const keys = oidc.getJwksCache(config)?.jwks.keys;
        const key = keys?.find(k => k.kid === header.kid && k.kty === "RSA");
        const keyIssuer = (key as { issuer?: unknown } | undefined)?.issuer;
        if (!key || header.alg !== "RS256" || typeof keyIssuer !== "string" ||
            keyIssuer.replace("{tenantid}", identity.tenantId) !== claims.iss) throw new CustomerAuthError();
        return identity;
      } catch { throw new CustomerAuthError(); }
    }
  };
}
