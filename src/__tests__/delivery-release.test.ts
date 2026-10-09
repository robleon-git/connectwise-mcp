import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ az: vi.fn(), execute: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), smoke: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: vi.fn() }));
vi.mock("../../scripts/deploy/common.mjs", () => ({ configuration: async () => ({ controlApi: "connectwise-control-api", migrationJob: "connectwise-migrate", resourceGroup: "monotorr-connectwise-prod-rg", registry: "monotorrdevacr6689" }), assertSubscription: vi.fn(), featureOnlyDeployment: vi.fn(), immutableImage: (_c: unknown, i: string) => i, needsDogfood: (p: string[]) => p.some(x => x === "src/auth/descope-mcp.ts"), az: mocks.az, execute: mocks.execute }));
vi.mock("../../scripts/deploy/smoke.mjs", () => ({ smoke: mocks.smoke }));
// @ts-expect-error Operator script has no declarations.
import { release } from "../../scripts/deploy/release.mjs";
const sha = "a".repeat(40), previous = "b".repeat(40), image = "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64);
beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockImplementation(async (_command: string, args: string[]) => ({ stdout: args[0] === "status" ? "" : args[0] === "rev-parse" ? sha : args[0] === "diff" ? "portal/src/main.tsx" : "" }));
    mocks.readFile.mockImplementation(async (path: string) => JSON.stringify(path.endsWith("built-image.json") ? { sha, image } : { sha, image, previousImage: image, previousSha: previous, previousRevision: "connectwise-control-api--previous", revision: "connectwise-control-api--candidate", candidateSmokePassed: true }));
    mocks.az.mockImplementation(async (args: string[]) => {
        if (args[0] === "acr")
            return JSON.stringify([previous]);
        if (args.includes("execution"))
            return "Failed";
        if (args.includes("start"))
            return "execution-1";
        if (args.includes("revision") && args.includes("show"))
            return JSON.stringify({ image, health: "Healthy" });
        if (args.includes("show"))
            return JSON.stringify({ mode: "Multiple", revision: "connectwise-control-api--previous", image, fqdn: "connectwise-control-api.domain.eastus.azurecontainerapps.io" });
        return "";
    });
});
describe("Phase 0 control-only release failure gates", () => {
    it("dirty source cannot trigger image build or app/job mutation", async () => { mocks.execute.mockResolvedValue({ stdout: " M package.json" }); await expect(release("prepare")).rejects.toThrow("dirty_release_source"); expect(mocks.az.mock.calls.some(c => c[0].includes("update"))).toBe(false); });
    it("failed migration prevents candidate and promotion; rollback evidence saved first", async () => { await expect(release("prepare")).rejects.toThrow("migration_not_succeeded"); expect(mocks.writeFile).toHaveBeenCalled(); expect(mocks.az.mock.calls.some(c => c[0][0] === "containerapp" && c[0][1] === "update")).toBe(false); expect(mocks.smoke).not.toHaveBeenCalled(); });
    it("MCP-affecting source cannot silently promote through this workflow", async () => { mocks.execute.mockImplementation(async (_c: string, args: string[]) => ({ stdout: args[0] === "rev-parse" ? sha : args[0] === "diff" ? "src/auth/descope-mcp.ts" : "" })); await expect(release("promote")).rejects.toThrow("mcp_affecting_release_requires_separate_review_and_owner_dogfood"); expect(mocks.az.mock.calls.some(c => c[0].includes("traffic"))).toBe(false); });
    it("promotes only the new API and checks existing MCP read-only", async () => { await expect(release("promote")).resolves.toMatchObject({ action: "promote" }); for (const call of mocks.az.mock.calls) {
        expect(call[0]).not.toContain("connectwise-mcp-pilot");
        expect(call[0]).not.toContain("monotorr-api-prod");
    } expect(mocks.smoke).toHaveBeenCalledWith("https://api.monotorr.com", "mcp"); });
    it("rejects stale source/evidence before traffic mutation", async () => { mocks.execute.mockResolvedValue({ stdout: "c".repeat(40) }); await expect(release("promote")).rejects.toThrow("artifact_source_mismatch"); expect(mocks.az.mock.calls.some(c => c[0].includes("traffic"))).toBe(false); });
    it("API rollback selects only recorded revision and does not invoke migration", async () => { await expect(release("rollback")).resolves.toMatchObject({ action: "rollback", revision: "connectwise-control-api--previous" }); expect(mocks.az.mock.calls.some(c => c[0].includes("job"))).toBe(false); });
});
