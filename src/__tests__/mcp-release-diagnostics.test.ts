import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
// @ts-expect-error Delivery script has no declarations.
import { azureFailureCategory, mcpAz, releaseDiagnostic, releaseFailure, markReleaseStage } from "../../scripts/deploy/mcp-release-diagnostics.mjs";
const canary = "SECRET-CANARY-Authorization-cookie-token-password-code";
describe("MCP-only safe Azure failure categories", () => {
  it.each([
    ["AuthorizationFailed", "authorization_failed"], ["LinkedAuthorizationFailed", "authorization_failed"],
    ["InvalidRequestContent", "invalid_payload"], ["InvalidParameter", "invalid_payload"],
    ["ResourceAlreadyExists", "resource_conflict"], ["Conflict", "resource_conflict"],
    ["InvalidResourceReference", "referenced_resource_error"], ["ResourceNotFound", "referenced_resource_error"]
  ])("maps only structured %s codes", async (code, category) => {
    for (const stderr of [`ERROR: (${code}) ${canary}`, JSON.stringify({ error: { code, message: canary, headers: canary } })]) {
      expect(azureFailureCategory(stderr)).toBe(category);
      const run = vi.fn().mockRejectedValue(Object.assign(new Error(canary), { stderr, stdout: canary, request: canary }));
      const error = await mcpAz(["rest", "--method", "put"], {}, run).catch((error: unknown) => error);
      const output = releaseDiagnostic(markReleaseStage(error, "candidate_arm_put"));
      expect(output).toEqual({ mcpReleaseSucceeded: false, stage: "candidate_arm_put", category });
      expect(JSON.stringify(output)).not.toContain(canary);
      expect(error).toBeInstanceOf(Error); expect((error as Error).message).toBe("azure_operation_failed");
      expect((error as Error).cause).toBeUndefined(); expect(JSON.stringify(error)).toBe("{}");
    }
  });
  it.each([undefined, canary, "AuthorizationFailed", 'ERROR: (NewUnknownCode) secret', '{"code":"BadRequest","details":[{"code":"AuthorizationFailed"}]}', '{"code":"BadRequest","details":[{"code":"UnknownCode"}]}'])("fails unknown/ambiguous/unstructured failures closed: %s", stderr => {
    expect(azureFailureCategory(stderr)).toBe("unknown");
  });
  it("ignores arbitrary exception properties and messages", () => {
    const error = Object.assign(new Error(canary), { category: "authorization_failed", stage: "candidate_arm_put", headers: canary, body: canary });
    expect(releaseDiagnostic(error)).toEqual({ mcpReleaseSucceeded: false, stage: "release", category: "unknown" });
    expect(releaseDiagnostic(markReleaseStage(error, canary))).toEqual({ mcpReleaseSucceeded: false, stage: "release", category: "unknown" });
  });
  it("preserves CLI nonzero exit and emits only the allowlisted failure record", () => {
    let caught: unknown;
    try { execFileSync(process.execPath, ["scripts/deploy/mcp-release.mjs"], { encoding: "utf8", stdio: "pipe", env: { ...process.env, SECRET_CANARY: canary } }); }
    catch (error) { caught = error; }
    const result = caught as { status: number; stdout: string; stderr: string };
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr.trim())).toEqual({ mcpReleaseSucceeded: false, stage: "release", category: "unknown" });
    expect(result.stderr).not.toContain(canary);
  });
});


describe("bounded production readiness diagnostics",()=>{
  it.each(["cutover","rollback"])("%s readiness categories never serialize foreign data",action=>{
    for(const suffix of ["readiness_timeout","revision_failed"]){
      const error=Object.assign(releaseFailure(`${action}_${suffix}`,canary),{body:canary,headers:canary,response:canary});
      const record=releaseDiagnostic(markReleaseStage(error,`${action}_readiness`));
      expect(record).toEqual({mcpReleaseSucceeded:false,stage:`${action}_readiness`,category:`${action}_${suffix}`});
      expect(JSON.stringify(record)).not.toContain(canary);
    }
  });
});
