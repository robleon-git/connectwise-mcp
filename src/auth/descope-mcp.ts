import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Environment } from "../config.js";
import { ConfigurationError } from "../diagnostics.js";

export interface DescopeMcpConfig {
  issuer: string;
  jwksUri: string;
  resourceUri: string;
  requiredScope: string;
  approvedUserId: string;
  /** Explicit JSON Pointer into the signed MCP access token, verified live before deployment. */
  approvedUserClaim: string;
}

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      /[\s"\\]/.test(value)) throw new Error("invalid URL");
  return url;
}

export function validateDescopeMcpConfig(config: DescopeMcpConfig): DescopeMcpConfig {
  try {
    const issuer = httpsUrl(config.issuer);
    httpsUrl(config.jwksUri);
    const resource = httpsUrl(config.resourceUri);
    // Never configure a generic Descope session/project issuer or an Entra issuer.
    if (!/^\/v1\/apps\/agentic\/P[A-Za-z0-9]+\/(?:MS|RS)[A-Za-z0-9]+$/.test(issuer.pathname) ||
        resource.pathname !== "/mcp" ||
        config.requiredScope !== "connectwise.read" ||
        !config.approvedUserId || config.approvedUserId.trim() !== config.approvedUserId ||
        !/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(config.approvedUserClaim)) {
      throw new Error("invalid configuration");
    }
    return Object.freeze({ ...config });
  } catch {
    throw new ConfigurationError("http-auth-required");
  }
}

export function getDescopeMcpConfig(env: Environment = process.env): DescopeMcpConfig | undefined {
  const values = [env.DESCOPE_MCP_ISSUER, env.DESCOPE_MCP_JWKS_URI, env.MCP_RESOURCE_URI,
    env.MCP_APPROVED_USER_ID, env.MCP_APPROVED_USER_CLAIM];
  if (!values.some(Boolean) && !env.MCP_REQUIRED_SCOPE) return undefined;
  return validateDescopeMcpConfig({
    issuer: env.DESCOPE_MCP_ISSUER || "", jwksUri: env.DESCOPE_MCP_JWKS_URI || "",
    resourceUri: env.MCP_RESOURCE_URI || "", requiredScope: env.MCP_REQUIRED_SCOPE || "connectwise.read",
    approvedUserId: env.MCP_APPROVED_USER_ID || "", approvedUserClaim: env.MCP_APPROVED_USER_CLAIM || "",
  });
}

export type AuthenticationResult =
  | { authenticated: true }
  | { authenticated: false; status: 401 | 403; error: "unauthorized" | "invalid_token" | "insufficient_scope" | "forbidden" };

function claimAtPointer(payload: unknown, pointer: string): unknown {
  let value = payload;
  for (const part of pointer.slice(1).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function createDescopeMcpAuthenticator(
  configInput: DescopeMcpConfig,
  // Dependency injection for offline tests; production uses only the configured HTTPS JWKS.
  keyResolver?: JWTVerifyGetKey,
): (request: IncomingMessage) => Promise<AuthenticationResult> {
  const config = validateDescopeMcpConfig(configInput);
  const jwks = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUri), {
    timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000,
  });
  return async request => {
    const header = request.headers.authorization;
    const count = request.rawHeaders?.filter((_, i) => i % 2 === 0 &&
      request.rawHeaders[i].toLowerCase() === "authorization").length;
    if (!header) return { authenticated: false, status: 401, error: "unauthorized" };
    if (typeof header !== "string" || (count !== undefined && count > 1) || header.length > 16384 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
      return { authenticated: false, status: 401, error: "invalid_token" };
    }
    try {
      const { payload } = await jwtVerify(header.slice(7), jwks, {
        issuer: config.issuer, audience: config.resourceUri, algorithms: ["RS256"],
        requiredClaims: ["iss", "aud", "exp", "sub"],
      });
      if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes(config.requiredScope)) {
        return { authenticated: false, status: 403, error: "insufficient_scope" };
      }
      if (claimAtPointer(payload, config.approvedUserClaim) !== config.approvedUserId) {
        return { authenticated: false, status: 403, error: "forbidden" };
      }
      return { authenticated: true };
    } catch {
      // JOSE/JWKS errors can contain token claims or network details. Never expose them.
      return { authenticated: false, status: 401, error: "invalid_token" };
    }
  };
}

export function protectedResourceMetadata(config: DescopeMcpConfig) {
  return { resource: config.resourceUri, authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope], bearer_methods_supported: ["header"] };
}

export function bearerChallenge(config: DescopeMcpConfig, error?: string): string {
  const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", config.resourceUri).href;
  return `Bearer resource_metadata="${metadataUrl}"` +
    (error === "invalid_token" ? ', error="invalid_token"' :
      error === "insufficient_scope" ? `, error="insufficient_scope", scope="${config.requiredScope}"` : "");
}
