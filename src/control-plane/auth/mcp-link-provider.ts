import * as oauth from "openid-client";
import { createResourceTokenVerifier, getDescopeResourceConfig, type McpPrincipal, type DescopeResourceConfig } from "../../auth/descope-mcp.js";
import { API_ORIGIN, API_PREFIX, CustomerAuthError } from "./identity.js";
export const MCP_LINK_CALLBACK = `${API_ORIGIN}${API_PREFIX}/ai/callback`;
export interface McpLinkFlow { state: string; verifier: string }
export interface McpLinkProvider { start(flow: McpLinkFlow): Promise<string>; complete(url: URL, flow: McpLinkFlow): Promise<McpPrincipal> }
export function linkingProviderFromConfig(config: oauth.Configuration, resource: DescopeResourceConfig,
  verify = createResourceTokenVerifier(resource)): McpLinkProvider {
  const metadata = config.serverMetadata();
  if (metadata.issuer !== resource.issuer || metadata.jwks_uri !== resource.jwksUri ||
      !metadata.code_challenge_methods_supported?.includes("S256") || !metadata.response_types_supported?.includes("code") ||
      !metadata.token_endpoint_auth_methods_supported?.includes("none")) throw new CustomerAuthError();
  for (const endpoint of [metadata.authorization_endpoint,metadata.token_endpoint]) {
    const url = new URL(endpoint || "");
    if (url.protocol !== "https:" || url.host !== new URL(resource.issuer).host || url.username || url.password || url.hash || url.search) throw new CustomerAuthError();
  }
  return {
    async start(flow) {
      return oauth.buildAuthorizationUrl(config,{redirect_uri:MCP_LINK_CALLBACK,response_type:"code",state:flow.state,
        code_challenge:await oauth.calculatePKCECodeChallenge(flow.verifier),code_challenge_method:"S256",
        scope:resource.requiredScope,resource:resource.resourceUri}).href;
    },
    async complete(url,flow) {
      try {
        const tokens = await oauth.authorizationCodeGrant(config,url,{pkceCodeVerifier:flow.verifier,expectedState:flow.state},
          {resource:resource.resourceUri});
        if (tokens.token_type.toLowerCase() !== "bearer") throw new Error();
        // Discard token response after verification: no refresh, session/ID-token substitution or persistence.
        return await verify(tokens.access_token);
      } catch { throw new CustomerAuthError(); }
    }
  };
}
export async function mcpLinkProvider(env: NodeJS.ProcessEnv): Promise<{provider:McpLinkProvider;resource:DescopeResourceConfig}> {
  if (!/^[A-Za-z0-9._-]{1,256}$/.test(env.CW_MCP_LINK_CLIENT_ID || "") || env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new CustomerAuthError();
  const resource = getDescopeResourceConfig(env);
  const config = await oauth.discovery(new URL(resource.issuer),env.CW_MCP_LINK_CLIENT_ID!,undefined,oauth.None(),{timeout:10});
  return {resource,provider:linkingProviderFromConfig(config,resource)};
}
