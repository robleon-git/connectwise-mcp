import { randomUUID } from "node:crypto";

/** Diagnostics deliberately accept no request headers, payloads or raw errors. */
const messages = {
  "http-auth-required": "HTTP requires configured authentication. For local testing only, explicitly enable unauthenticated loopback access.",
  "invalid-config": "Invalid service configuration; check required environment variables.",
  "cw-config-unavailable": "ConnectWise configuration could not be loaded; details redacted.",
  "gateway-disabled": "Per-request ConnectWise credentials are disabled for the Phase 1 HTTP service.",
  "read-only": "ConnectWise writes are disabled in Phase 1.",
} as const;

export class ConfigurationError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
    this.name = "ConfigurationError";
  }
}

export class ApiRequestError extends Error {
  constructor(readonly status?: number) {
    super(Number.isInteger(status) && status! >= 100 && status! <= 599
      ? `ConnectWise API returned ${status}.`
      : "ConnectWise request failed; details redacted.");
    this.name = "ApiRequestError";
  }
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof ConfigurationError) return messages[error.code];
  if (error instanceof ApiRequestError) return new ApiRequestError(error.status).message;
  return "Operation failed; error details redacted.";
}

type DiagnosticEvent = "server.started" | "server.stopped" | "server.failed" |
  "transport.failed" | "auth.denied" | "auth.accepted" | "oauth.failed";

export function logDiagnostic(event: DiagnosticEvent, error?: unknown): void {
  // Never stringify the raw object, message, cause, URL, identity or headers.
  console.error(`[${event}]${error === undefined ? "" : ` ${safeErrorMessage(error)}`}`);
}

const requestIds = new WeakMap<object, string>();
export function diagnosticRequestId(request: object): string {
  let id = requestIds.get(request);
  if (!id) { id = randomUUID(); requestIds.set(request, id); }
  return id;
}

const authReasons = ["no_bearer_token", "malformed_bearer_token", "jwt_verification_failed",
  "issuer_validation_failed", "audience_validation_failed", "time_validation_failed",
  "required_claim_missing", "missing_scope", "approved_user_missing", "approved_user_mismatch",
  "authenticator_failed", "authentication_rejected"] as const;
export type AuthDiagnosticReason = typeof authReasons[number];

/** Serialize only fixed enums and generated IDs. Never accept headers, tokens, or claims. */
export function logAuthDiagnostic(request: object, reason?: AuthDiagnosticReason, claimPath?: string): void {
  console.error(JSON.stringify({ event: reason ? "auth.denied" : "auth.accepted",
    requestId: diagnosticRequestId(request),
    ...(reason ? { reason: authReasons.includes(reason) ? reason : "authentication_rejected" } : {}),
    // Only the known nonsecret pilot path is printed; other configured pointers are masked.
    ...(claimPath ? { claimPath: claimPath === "/sub" ? "/sub" : "[configured]" } : {}),
  }));
}

export function logMcpDiagnostic(request: object, method: string | undefined,
  details: { rpcMethod?: string; status?: number }): void {
  const safeMethod = ["POST", "GET", "DELETE", "OPTIONS", "HEAD", "PUT", "PATCH"].includes(method || "")
    ? method : "other";
  const rpcMethod = ["initialize", "notifications/initialized", "tools/list", "tools/call", "ping"].includes(details.rpcMethod || "")
    ? details.rpcMethod : "other";
  console.error(JSON.stringify({ event: details.status === undefined ? "mcp.request" : "mcp.response",
    requestId: diagnosticRequestId(request), method: safeMethod, path: "/mcp",
    ...(details.status === undefined ? { rpcMethod } : {
      status: Number.isInteger(details.status) && details.status >= 100 && details.status <= 599 ? details.status : 500,
    }),
  }));
}
