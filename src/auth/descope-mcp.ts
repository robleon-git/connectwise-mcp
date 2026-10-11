import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from "jose";
import type { Environment } from "../config.js";
import { ConfigurationError, logAuthDiagnostic, type AuthDiagnosticReason } from "../diagnostics.js";

export interface DescopeResourceConfig {
  issuer: string;
  jwksUri: string;
  resourceUri: string;
  requiredScope: string;
}

export interface DescopeMcpConfig extends DescopeResourceConfig {
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
    validateDescopeResourceConfig(config);
    if (!config.approvedUserId || config.approvedUserId.trim() !== config.approvedUserId ||
        !/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/.test(config.approvedUserClaim)) throw new Error();
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
  | { authenticated: true; principal?: McpPrincipal }
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
    if (!header) {
      logAuthDiagnostic(request, "no_bearer_token");
      return { authenticated: false, status: 401, error: "unauthorized" };
    }
    if (typeof header !== "string" || (count !== undefined && count > 1) || header.length > 16384 ||
        !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(header)) {
      logAuthDiagnostic(request, "malformed_bearer_token");
      return { authenticated: false, status: 401, error: "invalid_token" };
    }
    try {
      const { payload } = await verifySignedResourceToken(header.slice(7), config, jwks);
      if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes(config.requiredScope)) {
        logAuthDiagnostic(request, "missing_scope");
        return { authenticated: false, status: 403, error: "insufficient_scope" };
      }
      if (claimAtPointer(payload, config.approvedUserClaim) !== config.approvedUserId) {
        logAuthDiagnostic(request, claimAtPointer(payload, config.approvedUserClaim) === undefined
          ? "approved_user_missing" : "approved_user_mismatch", config.approvedUserClaim);
        return { authenticated: false, status: 403, error: "forbidden" };
      }
      logAuthDiagnostic(request, undefined, config.approvedUserClaim);
      return { authenticated: true };
    } catch (error) {
      // JOSE/JWKS errors can contain token claims or network details. Never expose them.
      let reason: AuthDiagnosticReason = "jwt_verification_failed";
      if (error instanceof errors.JWTExpired) reason = "time_validation_failed";
      else if (error instanceof errors.JWTClaimValidationFailed) {
        if (error.reason === "missing") reason = error.claim === "sub" && config.approvedUserClaim === "/sub"
          ? "approved_user_missing" : "required_claim_missing";
        else if (error.claim === "iss") reason = "issuer_validation_failed";
        else if (error.claim === "aud") reason = "audience_validation_failed";
        else if (error.claim === "exp" || error.claim === "nbf") reason = "time_validation_failed";
      }
      logAuthDiagnostic(request, reason, reason === "approved_user_missing" ? config.approvedUserClaim : undefined);
      return { authenticated: false, status: 401, error: "invalid_token" };
    }
  };
}

export function protectedResourceMetadata(config: DescopeResourceConfig) {
  return { resource: config.resourceUri, authorization_servers: [config.issuer],
    scopes_supported: [config.requiredScope], bearer_methods_supported: ["header"] };
}

export function bearerChallenge(config: DescopeResourceConfig, error?: string): string {
  const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", config.resourceUri).href;
  return `Bearer resource_metadata="${metadataUrl}"` +
    (error === "invalid_token" ? ', error="invalid_token"' :
      error === "insufficient_scope" ? `, error="insufficient_scope", scope="${config.requiredScope}"` : "");
}

/** The SaaS resource boundary has no pilot subject allowlist. Account authorization follows verification. */
export interface McpPrincipal { readonly issuer: string; readonly subject: string }
export function validMcpPrincipal(principal: McpPrincipal) {
  return typeof principal?.issuer === "string" && typeof principal.subject === "string" &&
    principal.subject.length > 0 && principal.subject.length <= 512 && !/\s/.test(principal.subject) && !Array.from(principal.subject).some(c=>c.charCodeAt(0)<32 || c.charCodeAt(0)===127);
}
export function validateDescopeResourceConfig(config: DescopeResourceConfig): DescopeResourceConfig {
  try {
    const issuer = httpsUrl(config.issuer);
    httpsUrl(config.jwksUri);
    if (!/^\/v1\/apps\/agentic\/P[A-Za-z0-9]+\/(?:MS|RS)[A-Za-z0-9]+$/.test(issuer.pathname) ||
        httpsUrl(config.resourceUri).pathname !== "/mcp" || config.requiredScope !== "connectwise.read") throw new Error();
    return Object.freeze({ issuer: config.issuer, jwksUri: config.jwksUri, resourceUri: config.resourceUri, requiredScope: config.requiredScope });
  } catch { throw new ConfigurationError("http-auth-required"); }
}
export function getDescopeResourceConfig(env: Environment = process.env): DescopeResourceConfig {
  return validateDescopeResourceConfig({ issuer: env.DESCOPE_MCP_ISSUER || "", jwksUri: env.DESCOPE_MCP_JWKS_URI || "",
    resourceUri: env.MCP_RESOURCE_URI || "", requiredScope: env.MCP_REQUIRED_SCOPE || "connectwise.read" });
}
function verifySignedResourceToken(token: string, config: DescopeResourceConfig, key: JWTVerifyGetKey) {
  return jwtVerify(token, key, { issuer: config.issuer, audience: config.resourceUri, algorithms: ["RS256"],
    requiredClaims: ["iss", "aud", "exp", "sub"] });
}
export class ResourceTokenError extends Error {
  constructor(readonly scopeMissing = false, readonly reason: AuthDiagnosticReason = scopeMissing ? "missing_scope" : "jwt_verification_failed") { super("resource_token_rejected"); }
}
/** Returns only the stable verified principal, never the payload or token. Shared by linking and MCP. */
export function createResourceTokenVerifier(input: DescopeResourceConfig, key?: JWTVerifyGetKey) {
  const config = validateDescopeResourceConfig(input);
  const jwks = key ?? createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 5000, cooldownDuration: 30000, cacheMaxAge: 600000 });
  return async (token: string): Promise<McpPrincipal> => {
    try {
      if (typeof token !== "string" || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const { payload } = await verifySignedResourceToken(token, config, jwks);
      if (typeof payload.scope !== "string" || !payload.scope.split(" ").includes(config.requiredScope)) throw new ResourceTokenError(true);
      const principal = { issuer: config.issuer, subject: payload.sub as string };
      if (!validMcpPrincipal(principal)) throw new ResourceTokenError(false,"required_claim_missing");
      return Object.freeze(principal);
    } catch (error) {
      if (error instanceof ResourceTokenError) throw error;
      let reason: AuthDiagnosticReason = "jwt_verification_failed";
      if (error instanceof errors.JWTExpired) reason = "time_validation_failed";
      else if (error instanceof errors.JWTClaimValidationFailed) {
        if (error.reason === "missing") reason = "required_claim_missing";
        else if (error.claim === "iss") reason = "issuer_validation_failed";
        else if (error.claim === "aud") reason = "audience_validation_failed";
        else if (error.claim === "exp" || error.claim === "nbf") reason = "time_validation_failed";
      }
      throw new ResourceTokenError(false,reason);
    }
  };
}
export function createPrincipalAuthenticator(config: DescopeResourceConfig, key?: JWTVerifyGetKey) {
  const verify = createResourceTokenVerifier(config, key);
  return async (request: IncomingMessage): Promise<AuthenticationResult> => {
    const header = request.headers.authorization;
    if (!header) { logAuthDiagnostic(request, "no_bearer_token"); return { authenticated: false, status: 401, error: "unauthorized" }; }
    const count = request.rawHeaders?.filter((_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === "authorization").length;
    if (typeof header !== "string" || (count !== undefined && count > 1) || !/^Bearer /i.test(header)) {
      logAuthDiagnostic(request, "malformed_bearer_token"); return { authenticated: false, status: 401, error: "invalid_token" };
    }
    try {
      const principal = await verify(header.slice(7));
      logAuthDiagnostic(request, undefined, "/sub");
      return { authenticated: true, principal };
    } catch (error) {
      const missing = error instanceof ResourceTokenError && error.scopeMissing;
      logAuthDiagnostic(request,error instanceof ResourceTokenError ? error.reason : "jwt_verification_failed");
      return { authenticated: false, status: missing ? 403 : 401, error: missing ? "insufficient_scope" : "invalid_token" };
    }
  };
}
