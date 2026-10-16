import {createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({pool:vi.fn(),load:vi.fn(),migrate:vi.fn(),emit:vi.fn()}));
vi.mock("../database/pool.js",()=>({databasePool:mock.pool}));
vi.mock("../database/migrationRunner.js",async original=>({...await original<object>(),loadMigrations:mock.load,migrate:mock.migrate}));
vi.mock("../database/migrationBreadcrumb.js",async original=>({...await original<object>(),emitBreadcrumb:mock.emit}));
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllEnvs();});
async function cli(args:string[]) {
 const argv=process.argv,exit=process.exitCode;process.argv=["node","cli.js",...args];
 const log=vi.spyOn(console,"log").mockImplementation(()=>{}),error=vi.spyOn(console,"error").mockImplementation(()=>{}),end=vi.fn();
 mock.emit.mockResolvedValue(undefined);mock.pool.mockReturnValue({end});mock.load.mockResolvedValue([]);mock.migrate.mockResolvedValue({applied:0,requirements:["core"],appliedIds:[],deferredIds:[],installedOptionalIds:[]});
 try {vi.resetModules();await import("../database/cli.js");return{log,error,end,exitCode:process.exitCode};}finally{process.argv=argv;process.exitCode=exit;}
}
describe("explicit migration CLI",()=>{
 it.each([[],[""],["billing"],["core,unknown"],["core","extra"],["--skip-migration"]].map(args=>({args})))("rejects invalid execution args %j before package/database access",async ({args})=>{
  const result=await cli(args);expect(result.exitCode).toBe(1);expect(mock.load).not.toHaveBeenCalled();expect(mock.pool).not.toHaveBeenCalled();expect(mock.migrate).not.toHaveBeenCalled();expect(result.error).toHaveBeenCalledWith(JSON.stringify({event:"migration.failed"}));
 });
 it.each(["core","core,billing"])("loads full manifest and propagates explicit %s",async selection=>{
  const result=await cli([selection]);expect(mock.load.mock.calls[0][0]).toHaveLength(8);expect(mock.migrate.mock.calls[0][2]).toEqual(selection==="core"?[]:["billing"]);expect(result.end).toHaveBeenCalledOnce();expect(result.log).toHaveBeenCalledOnce();
 });
});

describe("release CLI breadcrumb contract",()=>{
 function context() {
  const c={repository:"robleon-git/connectwise-mcp",run:"123",attempt:"1",sha:"a".repeat(40),image:"monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:"+"b".repeat(64),request:"12345678-1234-1234-1234-123456789abc",selection:"core",manifestFingerprint:createHash("sha256").update("[]").digest("hex"),requestedAt:new Date().toISOString()};
  vi.stubEnv("CW_MIGRATION_CONTEXT",Buffer.from(JSON.stringify(c)).toString("base64url"));vi.stubEnv("CONTAINER_APP_JOB_EXECUTION_NAME","connectwise-migrate-example");return c;
 }
 it("flushes start before migration and terminal success after verified runner resolves",async()=>{
  const c=context(),result=await cli(["core"]);expect(result.exitCode).not.toBe(1);expect(mock.emit.mock.calls.map(([e])=>e.event)).toEqual(["migration.start","migration.success"]);
  expect(mock.emit.mock.calls[0][0].context).toEqual(c);expect(mock.emit.mock.calls[1][0]).toMatchObject({schemaVerified:true,transactionCommitted:true});
  expect(mock.emit.mock.invocationCallOrder[0]).toBeLessThan(mock.migrate.mock.invocationCallOrder[0]);expect(mock.emit.mock.invocationCallOrder[1]).toBeGreaterThan(mock.migrate.mock.invocationCallOrder[0]);
 });
 it("emits sanitized failure after runner failure, without inventing a commit outcome",async()=>{
  context();mock.migrate.mockRejectedValueOnce(new Error("private-secret-sql"));const result=await cli(["core"]);expect(result.exitCode).toBe(1);
  expect(mock.emit.mock.calls.map(([e])=>e.event)).toEqual(["migration.start","migration.failure"]);expect(mock.emit.mock.calls[1][0]).toMatchObject({schemaVerified:false,outcome:"unproven"});expect(JSON.stringify(mock.emit.mock.calls)).not.toContain("private-secret-sql");
 });
 it("emits failure for package mismatch before constructing database access",async()=>{
  context();mock.load.mockResolvedValueOnce([{unexpected:"invalid"}]);const result=await cli(["core"]);expect(result.exitCode).toBe(1);expect(mock.pool).not.toHaveBeenCalled();expect(mock.emit.mock.calls.map(([e])=>e.event)).toEqual(["migration.start","migration.failure"]);
 });
 it("requires context before production database access",async()=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("CW_DB_USER","cw_migrator");vi.stubEnv("CW_DB_PASSWORD_SECRET","cw-migration-db-password");vi.stubEnv("CW_MIGRATION_CONTEXT","");
  expect((await cli(["core"])).exitCode).toBe(1);expect(mock.pool).not.toHaveBeenCalled();expect(mock.load).not.toHaveBeenCalled();
 });
});

describe("unproven receipt publication never replays database work",()=>{
 function configure(){
  const c={repository:"robleon-git/connectwise-mcp",run:"123",attempt:"1",sha:"a".repeat(40),image:"monotorrdevacr6689.azurecr.io/connectwise-control-api@sha256:"+"b".repeat(64),request:"12345678-1234-1234-1234-123456789abc",selection:"core",manifestFingerprint:createHash("sha256").update("[]").digest("hex"),requestedAt:new Date().toISOString()};
  vi.stubEnv("CW_MIGRATION_CONTEXT",Buffer.from(JSON.stringify(c)).toString("base64url"));vi.stubEnv("CONTAINER_APP_JOB_EXECUTION_NAME","connectwise-migrate-example");
 }
 it("DB success plus failed completion publication stops unproven with no retry or second terminal write",async()=>{
  configure();mock.emit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("migration_receipt_publish_failed"));
  const result=await cli(["core"]);expect(result.exitCode).toBe(1);expect(mock.migrate).toHaveBeenCalledOnce();expect(mock.emit.mock.calls.map(([e])=>e.event)).toEqual(["migration.start","migration.success"]);expect(result.log).not.toHaveBeenCalled();expect(result.error).toHaveBeenCalledWith(JSON.stringify({event:"migration.failed"}));
 });
 it("failed start publication prevents database construction and does not retry",async()=>{
  configure();mock.emit.mockRejectedValueOnce(new Error("migration_receipt_conflict"));expect((await cli(["core"])).exitCode).toBe(1);expect(mock.emit).toHaveBeenCalledOnce();expect(mock.pool).not.toHaveBeenCalled();expect(mock.migrate).not.toHaveBeenCalled();
 });
});
