export type ConnectionFailure = "not_configured" | "invalid_input" | "invalid_url" | "unsafe_destination" | "unreachable_host" | "tls_failure" | "authentication_failed" | "connectwise_rejected" | "entitlement_required" | "already_configured" | "setup_in_progress" | "storage_unavailable";
export class ConnectionError extends Error {
  constructor(readonly code: ConnectionFailure, readonly httpStatus = 400) { super(code); this.name = "ConnectionError"; }
}
