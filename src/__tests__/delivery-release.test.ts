// @ts-expect-error Delivery script has no declarations.
import { migrationPlan } from "../../scripts/deploy/migration-features.mjs";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ az: vi.fn(), execute: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), smoke: vi.fn(), impact: vi.fn(), condition: vi.fn(), preflight: vi.fn(), receipt: vi.fn(), compatibility: vi.fn(), verifyCompatibility: vi.fn(), verifyMigration: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: vi.fn() }));
vi.mock("../../scripts/deploy/common.mjs", () => ({ configuration: async () => ({ controlApi: "connectwise-control-api", migrationJob: "connectwise-migrate", resourceGroup: "monotorr-connectwise-prod-rg", registry: "monotorrdevacr6689",customerLoginClientId:"4405ef16-dc89-4385-8a84-cda2a52274cf" }), assertSubscription: vi.fn(), featureOnlyDeployment: vi.fn(), immutableImage: (_c: unknown, i: string) => i, needsDogfood: (p: string[]) => p.some(x => x === "src/auth/descope-mcp.ts"), az: mocks.az, execute: mocks.execute }));
vi.mock("../../scripts/deploy/migration-features.mjs", async original => ({...await original<object>(), prepareSchemaCompatibility:mocks.compatibility, verifySchemaCompatibility:mocks.verifyCompatibility}));
vi.mock("../../scripts/deploy/mcp-impact.mjs", () => ({ assessMcpImpact: mocks.impact }));
vi.mock("../../scripts/deploy/smoke.mjs", () => ({ smoke: mocks.smoke }));
vi.mock("../../scripts/deploy/control-condition.mjs", async importOriginal => ({...await importOriginal<object>(),controlCondition:mocks.condition}));
vi.mock("../../scripts/deploy/migration-breadcrumbs.mjs",async original=>({...await original<object>(),
 breadcrumbPreflight:mocks.preflight, pollReceipt:mocks.receipt}));
vi.mock("../../scripts/deploy/migration-execution.mjs", async original => ({...await original<object>(), verifyMigration:mocks.verifyMigration}));
// @ts-expect-error Operator script has no declarations.
import { release } from "../../scripts/deploy/release.mjs";
const sha = "a".repeat(40), previous = "b".repeat(40), image = "monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:" + "a".repeat(64);
let schemaPlan: Awaited<ReturnType<typeof migrationPlan>>;
beforeEach(async () => {
    const actualFs=await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    mocks.readFile.mockImplementation(actualFs.readFile);
    schemaPlan=await migrationPlan("core");
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_REPOSITORY","robleon-git/connectwise-mcp");vi.stubEnv("GITHUB_RUN_ID","123");vi.stubEnv("GITHUB_RUN_ATTEMPT","1");
    mocks.compatibility.mockResolvedValue({version:"schema-compatibility-v1",compatible:true,target:{mcpImage:image},serving:{mcp:{image,revision:"mcp-prior"},control:{revision:"connectwise-control-api--previous",image}}});
    mocks.verifyCompatibility.mockResolvedValue(undefined);
    mocks.verifyMigration.mockResolvedValue(undefined);
    mocks.preflight.mockResolvedValue(undefined);
    mocks.receipt.mockImplementation(async (_call,context,execution)=>({version:"migration-breadcrumb-v1",context,execution,events:[],result:{}}));
    mocks.condition.mockResolvedValue({kind:"control-only",previousSha:previous,sha,moduleCount:39,protectedInputsEqual:true,migrationCount:4,migrationFingerprint:"c".repeat(64)});
    mocks.impact.mockResolvedValue({impact:"unchanged",changedOutputs:[]});
    mocks.execute.mockImplementation(async (_command: string, args: string[]) => ({ stdout: args[0] === "status" ? "" : args[0] === "rev-parse" ? sha : args[0] === "diff" ? "portal/src/main.tsx" : "" }));
    mocks.readFile.mockImplementation(async (path: string | URL) => path instanceof URL ? actualFs.readFile(path,"utf8") : JSON.stringify(path.endsWith("built-image.json") ? { sha, image } : { sha, image, previousImage: image, previousSha: previous, previousRevision: "connectwise-control-api--previous", revision: "connectwise-control-api--candidate", candidateSmokePassed: true, schemaPlan }));
    mocks.az.mockImplementation(async (args: string[]) => {
        if (args.some(arg=>arg.includes("containers[].{env:"))) return JSON.stringify([{env:[{name:"NODE_ENV",value:"production"},{name:"CW_BILLING_ENABLED",value:"false"}]}]);
        if (args.includes("job") && args.includes("show") && args.some(arg=>arg.includes("containers[].{image:"))) {
            const update=mocks.az.mock.calls.find(([a])=>a.includes("--set-env-vars"))?.[0];
            return JSON.stringify([{image,command:["node"],args:["dist/database/cli.js","core"],context:[update?.[update.indexOf("--set-env-vars")+1].split("=")[1]],store:[update?.[update.indexOf("--set-env-vars")+2].split("=")[1]]}]);
        }
        if (args[0] === "acr")
            return JSON.stringify([previous]);
        if (args.includes("execution"))
            return "Failed";
        if (args.includes("start"))
            return "execution-1";
        if (args.includes("revision") && args.includes("show"))
            return JSON.stringify({ image, health: "Healthy", active: true });
        if (args.includes("show"))
            return JSON.stringify({ mode: "Multiple", revision: "connectwise-control-api--previous", image, fqdn: "connectwise-control-api.domain.eastus.azurecontainerapps.io",traffic:[{revisionName:"connectwise-control-api--previous",weight:100}] });
        return "";
    });
});
afterEach(()=>vi.unstubAllEnvs());
describe("Phase 0 control-only release failure gates", () => {
    it("schema-compatible Slice 3 preparation performs zero migration job calls",async()=>{
        const original=mocks.az.getMockImplementation()!;
        mocks.az.mockImplementation(async(args:string[])=>args.includes("show")&&args.includes("--query")&&args.includes("properties.configuration.ingress.traffic")?JSON.stringify([{revisionName:"connectwise-control-api--previous",weight:100}]):original(args));
        await expect(release("prepare-slice3")).resolves.toMatchObject({prepared:true});
        expect(mocks.az.mock.calls.some(c=>c[0].includes("job"))).toBe(false);
        expect(mocks.condition).toHaveBeenCalledWith(previous,sha);
        const manifest=JSON.parse(mocks.writeFile.mock.calls.at(-1)![1]);expect(manifest.condition.kind).toBe("control-only");expect(manifest.execution).toBeUndefined();
        expect(mocks.az.mock.calls.every(c=>!c[0].includes("connectwise-mcp-pilot")&&!c[0].includes("connectwise-mcp-slice3-candidate"))).toBe(true);
    });
    it("unproven schema/impact fails before any live mutation",async()=>{
        mocks.condition.mockRejectedValue(new Error("control_only_schema_unproven"));
        await expect(release("prepare-slice3")).rejects.toThrow("control_only_schema_unproven");expect(mocks.az.mock.calls.some(c=>c[0].includes("set")||c[0].includes("update")||c[0].includes("start"))).toBe(false);
    });
    it("failed current readiness stops before mutation or job execution",async()=>{
        mocks.smoke.mockRejectedValueOnce(new Error("smoke_failed"));await expect(release("prepare-slice3")).rejects.toThrow("smoke_failed");expect(mocks.az.mock.calls.some(c=>c[0].includes("set")||c[0].includes("update")||c[0].includes("start"))).toBe(false);
    });
    it("MCP-affecting Slice 3 preparation still requires migration success",async()=>{
        mocks.condition.mockResolvedValue({kind:"mcp-affecting",previousSha:previous,sha});
        const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.includes("show")&&args.includes("properties.configuration.ingress.traffic")?JSON.stringify([{revisionName:"connectwise-control-api--previous",weight:100}]):original(args));
        await expect(release("prepare-slice3")).rejects.toThrow("migration_not_succeeded");expect(mocks.az.mock.calls.some(c=>c[0].includes("job")&&c[0].includes("start"))).toBe(true);
    });
    it("billing OFF does not bypass the MCP-affecting migration job or its failure gate",async()=>{
        vi.stubEnv("CW_BILLING_ENABLED","false");
        try {
            mocks.condition.mockResolvedValue({kind:"mcp-affecting",previousSha:previous,sha});
            const original=mocks.az.getMockImplementation()!;
            mocks.az.mockImplementation(async(args:string[])=>args.includes("show")&&args.includes("properties.configuration.ingress.traffic")?JSON.stringify([{revisionName:"connectwise-control-api--previous",weight:100}]):original(args));
            await expect(release("prepare-slice3")).rejects.toThrow("migration_not_succeeded");
            expect(mocks.az.mock.calls.some(c=>c[0].includes("job")&&c[0].includes("update"))).toBe(true);
            expect(mocks.az.mock.calls.some(c=>c[0].includes("job")&&c[0].includes("start"))).toBe(true);
            expect(mocks.az.mock.calls.some(c=>c[0][0]==="containerapp"&&c[0][1]==="update")).toBe(false);
        } finally {vi.unstubAllEnvs();}
    });
    it("dirty source cannot trigger image build or app/job mutation", async () => { mocks.execute.mockResolvedValue({ stdout: " M package.json" }); await expect(release("prepare")).rejects.toThrow("dirty_release_source"); expect(mocks.az.mock.calls.some(c => c[0].includes("update"))).toBe(false); });
    it("failed migration prevents candidate and promotion; rollback evidence saved first", async () => { await expect(release("prepare")).rejects.toThrow("migration_not_succeeded"); expect(mocks.writeFile).toHaveBeenCalled(); expect(mocks.az.mock.calls.some(c => c[0][0] === "containerapp" && c[0][1] === "update")).toBe(false); expect(mocks.smoke).not.toHaveBeenCalled(); });
    it("MCP-affecting source cannot silently promote through this workflow", async () => { mocks.impact.mockResolvedValue({impact:"changed",changedOutputs:["dist/auth/descope-mcp.js"]}); await expect(release("promote")).rejects.toThrow("mcp_affecting_release_requires_separate_review_and_owner_dogfood"); expect(mocks.az.mock.calls.some(c => c[0].includes("traffic"))).toBe(false); });
    it("promotes only the new API and checks existing MCP read-only", async () => { await expect(release("promote")).resolves.toMatchObject({ action: "promote" }); for (const call of mocks.az.mock.calls) {
        expect(call[0]).not.toContain("connectwise-mcp-pilot");
        expect(call[0]).not.toContain("monotorr-api-prod");
    } expect(mocks.smoke).toHaveBeenCalledWith("https://api.monotorr.com", "mcp"); });
    it("rejects stale source/evidence before traffic mutation", async () => { mocks.execute.mockResolvedValue({ stdout: "c".repeat(40) }); await expect(release("promote")).rejects.toThrow("artifact_source_mismatch"); expect(mocks.az.mock.calls.some(c => c[0].includes("traffic"))).toBe(false); });
    it("API rollback selects only recorded revision and does not invoke migration", async () => { await expect(release("rollback")).resolves.toMatchObject({ action: "rollback", revision: "connectwise-control-api--previous" }); expect(mocks.az.mock.calls.some(c => c[0].includes("job"))).toBe(false); });
});


describe("selected revision activation during promotion", () => {
    it("activates an inactive revision before assigning traffic", async () => {
        const original = mocks.az.getMockImplementation()!;
        mocks.az.mockImplementation(async (args: string[]) => {
            if (args.some(arg=>arg.includes("containers[].{env:"))) return original(args);
            if (args.includes("revision") && args.includes("show"))
                return JSON.stringify({ image, health: "Healthy", active: false });
            return original(args);
        });
        await expect(release("promote")).resolves.toMatchObject({ action: "promote" });
        const calls = mocks.az.mock.calls.map(call => call[0] as string[]);
        const activation = calls.findIndex(args => args.includes("activate"));
        const promotion = calls.findIndex(args => args.includes("traffic"));
        expect(activation).toBeGreaterThanOrEqual(0);
        expect(promotion).toBeGreaterThan(activation);
        expect(calls[activation]).toContain("connectwise-control-api--candidate");
        expect(calls[promotion]).toContain("connectwise-control-api--candidate=100");
    });
    it("skips activation of an already-active revision and still promotes", async () => {
        await expect(release("promote")).resolves.toMatchObject({ action: "promote" });
        expect(mocks.az.mock.calls.some(call => call[0].includes("activate"))).toBe(false);
        const traffic = mocks.az.mock.calls.filter(call => call[0].includes("traffic"));
        expect(traffic).toHaveLength(1);
        expect(traffic[0][0]).toContain("connectwise-control-api--candidate=100");
        expect(mocks.smoke).toHaveBeenCalledTimes(2);
    });
    it("fails closed before traffic mutation when inactive-revision activation fails", async () => {
        const original = mocks.az.getMockImplementation()!;
        mocks.az.mockImplementation(async (args: string[]) => {
            if (args.some(arg=>arg.includes("containers[].{env:"))) return original(args);
            if (args.includes("revision") && args.includes("show"))
                return JSON.stringify({ image, health: "Healthy", active: false });
            if (args.includes("activate")) throw new Error("azure_operation_failed");
            return original(args);
        });
        await expect(release("promote")).rejects.toThrow("azure_operation_failed");
        expect(mocks.az.mock.calls.some(call => call[0].includes("traffic"))).toBe(false);
        expect(mocks.smoke).not.toHaveBeenCalled();
    });
    it("retains production traffic when Azure rejects the traffic update", async () => {
        const original = mocks.az.getMockImplementation()!;
        const productionTraffic = [{ revisionName: "connectwise-control-api--previous", weight: 100 }];
        let traffic = productionTraffic;
        mocks.az.mockImplementation(async (args: string[]) => {
            if (args.includes("traffic")) {
                // Model an ARM rejection before the update is applied, not an ambiguous timeout.
                if (args.includes("connectwise-control-api--candidate=100"))
                    throw new Error("azure_operation_failed");
                traffic = [];
            }
            return original(args);
        });
        await expect(release("promote")).rejects.toThrow("azure_operation_failed");
        expect(traffic).toEqual(productionTraffic);
        expect(mocks.az.mock.calls.filter(call => call[0].includes("traffic"))).toHaveLength(1);
        expect(mocks.az.mock.calls.some(call => call[0].includes("deactivate"))).toBe(false);
        expect(mocks.smoke).not.toHaveBeenCalled();
    });
    it.each([undefined, null, "true"])("rejects unknown active state %s before mutation", async active => {
        const original = mocks.az.getMockImplementation()!;
        mocks.az.mockImplementation(async (args: string[]) => {
            if (args.some(arg=>arg.includes("containers[].{env:"))) return original(args);
            if (args.includes("revision") && args.includes("show"))
                return JSON.stringify({ image, health: "Healthy", active });
            return original(args);
        });
        await expect(release("promote")).rejects.toThrow("revision_active_state_unknown");
        expect(mocks.az.mock.calls.some(call => call[0].includes("activate") || call[0].includes("traffic"))).toBe(false);
    });
});


describe("approved reusable candidate label", () => {
    it("moves the existing label without a second CLI prompt and pins production to the prior revision", async () => {
        const original = mocks.az.getMockImplementation()!;
        mocks.az.mockImplementation(async (args: string[]) => {
            if (args.includes("properties.status")) return "Succeeded";
            return original(args);
        });
        await expect(release("prepare")).resolves.toMatchObject({ prepared: true });
        const calls = mocks.az.mock.calls.map(call => call[0] as string[]);
        const label = calls.find(args => args.includes("label") && args.includes("add"))!;
        expect(label).toContain("--yes");
        expect(label).toContain("candidate");
        expect(label).toContain(`connectwise-control-api--p0-${sha.slice(0,12)}`);
        const pin = calls.findIndex(args => args.includes("traffic"));
        expect(calls[pin]).toContain("connectwise-control-api--previous=100");
        expect(pin).toBeLessThan(calls.indexOf(label));
        expect(calls.filter(args => args.includes("traffic"))).toHaveLength(1);
    });
});


describe("compiled MCP impact promotion gate",()=>{
 it("allows proven control-only shared code without bypass flags",async()=>{
  await release("promote");expect(mocks.impact).toHaveBeenCalledWith(previous,sha);
  expect(mocks.az.mock.calls.some(call=>call[0].includes("traffic"))).toBe(true);
 });
 it("fails closed on ambiguous impact before activation or traffic",async()=>{
  mocks.impact.mockResolvedValue({impact:"unknown",changedOutputs:[]});
  await expect(release("promote")).rejects.toThrow("mcp_affecting_release_requires_separate_review_and_owner_dogfood");
  expect(mocks.az.mock.calls.some(call=>call[0].includes("activate")||call[0].includes("traffic"))).toBe(false);
 });
});


describe("promotion source cleanliness",()=>{
 it("refuses uncommitted executable or guard changes before proof or traffic",async()=>{
  const original=mocks.execute.getMockImplementation()!;
  mocks.execute.mockImplementation(async(command:string,args:string[])=>args[0]==="status"?{stdout:" M scripts/deploy/mcp-impact.mjs"}:original(command,args));
  await expect(release("promote")).rejects.toThrow("dirty_release_source");
  expect(mocks.impact).not.toHaveBeenCalled();expect(mocks.az.mock.calls.some(call=>call[0].includes("traffic"))).toBe(false);
 });
});


describe("Slice 2 candidate-only setup setting",()=>{
 it("sets setup true only in the new control candidate update after migration",async()=>{
  const original=mocks.az.getMockImplementation()!;
  mocks.az.mockImplementation(async(args:string[])=>args.includes("properties.status")?"Succeeded":original(args));
  await release("prepare");
  const updates=mocks.az.mock.calls.map(call=>call[0] as string[]).filter(args=>args.includes("CW_CONNECTION_SETUP_ENABLED=true"));
  expect(updates).toHaveLength(1);expect(updates[0].slice(0,2)).toEqual(["containerapp","update"]);
  expect(updates[0]).toContain("connectwise-control-api");expect(updates[0]).toContain(`p0-${sha.slice(0,12)}`);
  expect(updates[0]).not.toContain("connectwise-mcp-pilot");
 });
 it.each(["promote","rollback"])("does not alter settings during %s",async action=>{
  await release(action);expect(mocks.az.mock.calls.some(call=>call[0].includes("CW_CONNECTION_SETUP_ENABLED=true"))).toBe(false);
 });
});

describe("reviewed migration execution propagation",()=>{
 it("passes the exact feature selection to the job, verifies readback and records the sanitized result",async()=>{
  mocks.condition.mockResolvedValue({kind:"mcp-affecting",previousSha:previous,sha});
  const original=mocks.az.getMockImplementation()!;
  mocks.az.mockImplementation(async(args:string[])=>args.includes("properties.status")?"Succeeded":args.includes("properties.configuration.ingress.traffic")?JSON.stringify([{revisionName:"connectwise-control-api--previous",weight:100}]):original(args));
  await release("prepare-slice3");
  const update=mocks.az.mock.calls.find(([args])=>args.includes("job")&&args.includes("update"))![0];
  expect(update.slice(update.indexOf("--command"),update.indexOf("--set-env-vars"))).toEqual(["--command","node","--args","dist/database/cli.js","core"]);
  const evidence=JSON.parse(mocks.writeFile.mock.calls.at(-1)![1]);
  expect(evidence.schemaPlan).toEqual(schemaPlan);expect(evidence.migrationProof).toMatchObject({sourceSha:sha,image,schemaVerified:true,azureExecutionSucceeded:true});expect(evidence.migrationResult).toBeUndefined();
 });
 it("unknown target feature state fails before any live mutation",async()=>{
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.some(arg=>arg.includes("containers[].{env:"))?JSON.stringify([{env:[{name:"CW_BILLING_ENABLED",value:"unknown"}]}]):original(args));
  await expect(release("prepare-slice3")).rejects.toThrow();expect(mocks.az.mock.calls.some(([args])=>args.includes("update")||args.includes("set")||args.includes("start"))).toBe(false);
 });
 it("a feature expansion cannot use the migration-free control-only lane",async()=>{
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.includes("revision")&&args.some(arg=>arg.includes("containers[].{env:"))?JSON.stringify([{env:[{name:"CW_BILLING_ENABLED",value:"true"}]}]):original(args));
  await expect(release("prepare-slice3")).rejects.toThrow();expect(mocks.az.mock.calls.some(([args])=>args.includes("update")||args.includes("set")||args.includes("start"))).toBe(false);
 });
 it("job image/argument drift blocks execution",async()=>{
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.some(arg=>arg.includes("containers[].{image:"))?JSON.stringify([{image,command:["node"],args:["dist/database/cli.js","core,billing"]}]):original(args));
  await expect(release("prepare")).rejects.toThrow("migration_job_mismatch");expect(mocks.az.mock.calls.some(([args])=>args.includes("start"))).toBe(false);expect(mocks.az.mock.calls.some(([args])=>args[0]==="containerapp"&&args[1]==="update")).toBe(false);
 });
 it("successful job without verifiable completion evidence cannot prepare a candidate",async()=>{
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.includes("properties.status")?"Succeeded":original(args));
  mocks.receipt.mockRejectedValueOnce(new Error("migration_receipt_timeout"));
  await expect(release("prepare")).rejects.toThrow("migration_receipt_timeout");expect(mocks.az.mock.calls.some(([args])=>args[0]==="containerapp"&&args[1]==="update")).toBe(false);
 });
 it("promotion refuses absent or stale feature-plan evidence before traffic changes",async()=>{
  const original=mocks.readFile.getMockImplementation()!;
  mocks.readFile.mockImplementation(async(path:string|URL)=>{
   const result=await original(path);if(path instanceof URL)return result;const data=JSON.parse(result);data.schemaPlan={...schemaPlan,selection:"core,billing"};return JSON.stringify(data);
  });
  await expect(release("promote")).rejects.toThrow("control_features_changed");expect(mocks.az.mock.calls.some(([args])=>args.includes("activate")||args.includes("traffic"))).toBe(false);
 });
});

describe("durable migration delivery safety",()=>{
 it("retention or query failure blocks every mutation",async()=>{
  mocks.preflight.mockRejectedValueOnce(new Error("migration_retention_unproven"));
  await expect(release("prepare")).rejects.toThrow("migration_retention_unproven");expect(mocks.az.mock.calls.some(([args])=>args.includes("set")||args.includes("update")||args.includes("start"))).toBe(false);
 });
 it("receipt alone cannot override failed Azure execution",async()=>{
  await expect(release("prepare")).rejects.toThrow("migration_not_succeeded");expect(mocks.receipt).toHaveBeenCalledOnce();expect(mocks.az.mock.calls.filter(([a])=>a.includes("start"))).toHaveLength(1);
  expect(mocks.az.mock.calls.some(([a])=>a.includes("logs")||a.includes("replica"))).toBe(false);expect(mocks.az.mock.calls.some(([a])=>a[0]==="containerapp"&&a[1]==="update")).toBe(false);
 });
 it("execution image/context mismatch cannot use a receipt",async()=>{
  const original=mocks.az.getMockImplementation()!;
  mocks.az.mockImplementation(async(args:string[])=>args.includes("execution")&&args.some(a=>a.includes("containers[]."))?"[]":original(args));
  await expect(release("prepare")).rejects.toThrow("migration_execution_mismatch");expect(mocks.receipt).not.toHaveBeenCalled();
 });
 it("job context mismatch blocks start",async()=>{
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.some(a=>a.includes("containers[].{image:"))?JSON.stringify([{image,command:["node"],args:["dist/database/cli.js","core"],context:["wrong"]}]):original(args));
  await expect(release("prepare")).rejects.toThrow("migration_job_context_mismatch");expect(mocks.az.mock.calls.some(([a])=>a.includes("start"))).toBe(false);
 });
});

describe("artifact compatibility gates precede live mutations",()=>{
 it("rejects unsupported serving/rollback schema before traffic, job, or control mutation",async()=>{
  mocks.compatibility.mockRejectedValue(new Error("release_schema_incompatible"));
  await expect(release("prepare-slice3")).rejects.toThrow("release_schema_incompatible");
  expect(mocks.az.mock.calls.some(([args])=>args.includes("set")||args.includes("update")||args.includes("start"))).toBe(false);
  expect(mocks.preflight).not.toHaveBeenCalled();
 });
 it.each(["promote","rollback"])("%s rejects missing, stale or mismatched proof before activation/traffic",async action=>{
  mocks.verifyCompatibility.mockRejectedValue(new Error("schema_compatibility_unproven"));
  await expect(release(action)).rejects.toThrow("schema_compatibility_unproven");
  expect(mocks.az.mock.calls.some(([args])=>args.includes("activate")||args.includes("set")||args.includes("update"))).toBe(false);
 });
 it("retains the computed proof in preparation evidence",async()=>{
  const proof={version:"schema-compatibility-v1",compatible:true,target:{sha},serving:{control:{revision:"connectwise-control-api--previous",image}}};mocks.compatibility.mockResolvedValue(proof);
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.includes("show")&&args.includes("properties.configuration.ingress.traffic")?JSON.stringify([{revisionName:"connectwise-control-api--previous",weight:100}]):original(args));
  await release("prepare-slice3");expect(JSON.parse(mocks.writeFile.mock.calls.at(-1)![1]).schemaCompatibility).toEqual(proof);
 });
});

describe("preparation uses the reviewed MCP build and production baseline",()=>{
 it("stops before any mutation if independently read proof differs from reviewed MCP evidence",async()=>{
  mocks.compatibility.mockResolvedValue({target:{mcpImage:"different"},serving:{mcp:{image:"old",revision:"old"},control:{revision:"connectwise-control-api--previous",image}}});
  await expect(release("prepare-slice3",{image:"reviewed",baseline:{image:"old",revision:"old"}})).rejects.toThrow("schema_compatibility_baseline_changed");
  expect(mocks.az.mock.calls.some(([args])=>args.includes("set")||args.includes("update")||args.includes("start"))).toBe(false);
 });
});


describe("migration-only proof reuse during preparation",()=>{
 const expected={image,baseline:{image,revision:"mcp-prior"}};
 it("reuses the proven execution without job update/start or a second receipt execution",async()=>{
  mocks.condition.mockResolvedValue({kind:"mcp-affecting",previousSha:previous,sha});
  const migration={version:"release-migration-v1",status:"proven",execution:"previous-migration",attestation:{schemaVerified:true},schemaCompatibility:await mocks.compatibility()};
  const original=mocks.az.getMockImplementation()!;mocks.az.mockImplementation(async(args:string[])=>args.includes("properties.configuration.ingress.traffic")?JSON.stringify([{revisionName:"connectwise-control-api--previous",weight:100}]):original(args));
  await expect(release("prepare-slice3",{...expected,migration,migrationRequired:true})).resolves.toMatchObject({prepared:true});
  expect(mocks.verifyMigration).toHaveBeenCalledOnce();expect(mocks.az.mock.calls.some(([args])=>args.includes("job"))).toBe(false);expect(mocks.receipt).not.toHaveBeenCalled();
  const manifest=JSON.parse(mocks.writeFile.mock.calls.at(-1)![1]);expect(manifest.migration).toEqual(migration);expect(manifest.execution).toBe("previous-migration");
 });
 it("rejects an older build-only artifact that omits required migration proof",async()=>{
  mocks.condition.mockResolvedValue({kind:"mcp-affecting",previousSha:previous,sha});await expect(release("prepare-slice3",{...expected,migrationRequired:true})).rejects.toThrow("migration_evidence_required");expect(mocks.az.mock.calls.some(([args])=>args.includes("update")||args.includes("set")||args.includes("start"))).toBe(false);
 });
 it.each(["migration_evidence_unproven","migration_receipt_expired"])("rejects %s before control or traffic mutation",async message=>{
  mocks.verifyMigration.mockRejectedValueOnce(new Error(message));await expect(release("prepare-slice3",{...expected,migration:{status:"proven"}})).rejects.toThrow(message);expect(mocks.az.mock.calls.some(([args])=>args.includes("update")||args.includes("set")||args.includes("start"))).toBe(false);
 });
});
