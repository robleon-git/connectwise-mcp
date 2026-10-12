// MCP delivery only: retain categorical evidence, never raw command failure data.
import { execute } from "./common.mjs";
const stages = new Set(["release", "baseline", "candidate_existence_check", "candidate_payload", "candidate_arm_put", "candidate_evidence", "cutover_readiness", "rollback_readiness"]);
const categories = new Set(["baseline_changed", "authorization_failed", "invalid_payload", "resource_conflict", "referenced_resource_error", "unknown", "cutover_readiness_timeout", "cutover_revision_failed", "rollback_readiness_timeout", "rollback_revision_failed"]);
const evidence = new WeakMap();
export function releaseFailure(category, message = "azure_operation_failed") {
  const error = new Error(message);
  evidence.set(error, { category: categories.has(category) ? category : "unknown" });
  return error;
}
export function markReleaseStage(error, stage) {
  // Foreign exceptions may contain secrets. Do not serialize or inspect their messages.
  if (!(error instanceof Error)) error = new Error("release_failed");
  evidence.set(error, { ...evidence.get(error), stage: stages.has(stage) ? stage : "release" });
  return error;
}
export function releaseDiagnostic(error) {
  const value = error instanceof Error ? evidence.get(error) : undefined;
  return { mcpReleaseSucceeded: false,
    stage: stages.has(value?.stage) ? value.stage : "release",
    category: categories.has(value?.category) ? value.category : "unknown" };
}
const azureCodes = Object.freeze({
  AuthorizationFailed: "authorization_failed", LinkedAuthorizationFailed: "authorization_failed",
  InvalidAuthenticationToken: "authorization_failed", AuthenticationFailed: "authorization_failed",
  InvalidRequestContent: "invalid_payload", InvalidRequest: "invalid_payload", InvalidParameter: "invalid_payload",
  InvalidResource: "invalid_payload", BadRequest: "invalid_payload",
  ResourceAlreadyExists: "resource_conflict", Conflict: "resource_conflict", OperationInProgress: "resource_conflict",
  InvalidResourceReference: "referenced_resource_error", ResourceNotFound: "referenced_resource_error",
  LinkedInvalidPropertyId: "referenced_resource_error"
});
export function azureFailureCategory(stderr) {
  if (typeof stderr !== "string") return "unknown";
  // Only structured Azure code fields or CLI ERROR: (Code) prefixes. Never free-text matching.
  const codes = [...stderr.matchAll(/(?:"code"\s*:\s*"([A-Za-z]+)"|(?:^|\n)ERROR:\s*\(([A-Za-z]+)\))/g)]
    .map(match => match[1] || match[2]);
  if (!codes.length || codes.some(code => !Object.hasOwn(azureCodes, code))) return "unknown";
  const mapped = new Set(codes.map(code => azureCodes[code]));
  return mapped.size === 1 ? [...mapped][0] : "unknown";
}
export async function mcpAz(args, run = execute) {
  try {
    return (await run("az", [...args, "--only-show-errors"], {
      timeout: 120000, maxBuffer: 1024 * 1024,
      env: { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no" }
    })).stdout.trim();
  } catch (error) {
    // Drop stdout, stderr, headers, body, command arguments, stack and cause.
    throw releaseFailure(azureFailureCategory(error?.stderr));
  }
}
