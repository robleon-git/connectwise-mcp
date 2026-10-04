/** Diagnostics deliberately accept no request headers, payloads or raw errors. */
const messages = {
  "http-auth-required": "HTTP requires configured authentication. For local testing only, explicitly enable unauthenticated loopback access.",
  "invalid-config": "Invalid service configuration; check required environment variables.",
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
