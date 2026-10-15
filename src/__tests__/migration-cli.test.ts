import {afterEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({pool:vi.fn(),load:vi.fn(),migrate:vi.fn()}));
vi.mock("../database/pool.js",()=>({databasePool:mock.pool}));
vi.mock("../database/migrationRunner.js",async original=>({...await original<object>(),loadMigrations:mock.load,migrate:mock.migrate}));
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();});
async function cli(args:string[]) {
 const argv=process.argv,exit=process.exitCode;process.argv=["node","cli.js",...args];
 const log=vi.spyOn(console,"log").mockImplementation(()=>{}),error=vi.spyOn(console,"error").mockImplementation(()=>{}),end=vi.fn();
 mock.pool.mockReturnValue({end});mock.load.mockResolvedValue([]);mock.migrate.mockResolvedValue({applied:0,requirements:["core"],appliedIds:[],deferredIds:[],installedOptionalIds:[]});
 try {vi.resetModules();await import("../database/cli.js");return{log,error,end,exitCode:process.exitCode};}finally{process.argv=argv;process.exitCode=exit;}
}
describe("explicit migration CLI",()=>{
 it.each([[],[""],["billing"],["core,unknown"],["core","extra"],["--skip-migration"]].map(args=>({args})))("rejects invalid execution args %j before package/database access",async ({args})=>{
  const result=await cli(args);expect(result.exitCode).toBe(1);expect(mock.load).not.toHaveBeenCalled();expect(mock.pool).not.toHaveBeenCalled();expect(mock.migrate).not.toHaveBeenCalled();expect(result.error).toHaveBeenCalledWith(JSON.stringify({event:"migration.failed"}));
 });
 it.each(["core","core,billing"])("loads full manifest and propagates explicit %s",async selection=>{
  const result=await cli([selection]);expect(mock.load.mock.calls[0][0]).toHaveLength(7);expect(mock.migrate.mock.calls[0][2]).toEqual(selection==="core"?[]:["billing"]);expect(result.end).toHaveBeenCalledOnce();expect(result.log).toHaveBeenCalledOnce();
 });
});
