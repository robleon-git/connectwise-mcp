import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import {MIGRATIONS} from "../database/migrationManifest.js";
import {loadMigrations,migrate,migrationFeatures} from "../database/migrationRunner.js";
// @ts-expect-error Delivery script has no declarations.
import {controlRequirements,migrationPlan,migrationJobArgs,readControlRequirements,verifyControlRequirements,migrationCompletion} from "../../scripts/deploy/migration-features.mjs";
const core=MIGRATIONS.filter(m=>m.requirement==="core"),optional=MIGRATIONS.filter(m=>m.requirement==="billing");
const rows=(items:readonly {id:string;checksum:string}[])=>items.map(({id,checksum})=>({id,checksum}));
function database(initial=rows([]),failSql?:string) {
 const installed=[...initial];
 const query=vi.fn(async(sql:string,args?:unknown[])=>{
  if(sql===failSql)throw new Error("synthetic-private-sql-error");
  if(sql.startsWith("INSERT INTO public.schema_migrations"))installed.push({id:args![0] as string,checksum:args![1] as string});
  return {rows:sql.startsWith("SELECT id, checksum")?[...installed]:[]};
 });
 const release=vi.fn(),connect=vi.fn(async()=>({query,release}));return {connect,query,release,installed};
}
const loaded=()=>loadMigrations(MIGRATIONS,new URL("../../database/migrations/",import.meta.url));
describe("explicit feature-scoped migration execution",()=>{
 it.each([undefined,null,"", "billing","core,unknown","core,core","core,billing,billing",[],{}])("rejects missing/malformed selection %j",selection=>{
  expect(()=>migrationFeatures(selection)).toThrow("invalid_migration_features");
 });
 it.each([undefined,null,["unknown"],["billing","billing"],"billing",{}])("rejects invalid runner features before connecting %j",async features=>{
  const db=database();await expect(migrate(db as never,await loaded(),features as never)).rejects.toThrow("migration_failed");expect(db.connect).not.toHaveBeenCalled();
 });
 it("validates full package, applies core only, explicitly defers billing and is idempotent",async()=>{
  const db=database(),all=await loaded();
  expect(await migrate(db as never,all,[])).toEqual({applied:core.length,requirements:["core"],appliedIds:core.map(m=>m.id),deferredIds:optional.map(m=>m.id),installedOptionalIds:[]});
  for(const item of all.filter(m=>m.requirement==="billing"))expect(db.query.mock.calls.some(([sql])=>sql===item.sql)).toBe(false);
  expect(await migrate(db as never,all,[])).toMatchObject({applied:0,appliedIds:[]});
  expect(await migrate(db as never,all,["billing"])).toEqual({applied:optional.length,requirements:["core","billing"],appliedIds:optional.map(m=>m.id),deferredIds:[],installedOptionalIds:optional.map(m=>m.id)});
  expect(await migrate(db as never,all,[])).toMatchObject({applied:0,deferredIds:[],installedOptionalIds:optional.map(m=>m.id)});
 });
 it("Release B applies only missing 0008 under core and keeps billing deferred",async()=>{
  const db=database(rows(core.filter(m=>m.id!=="0008_account_name_edit"))),all=await loaded();
  expect(await migrate(db as never,all,[])).toMatchObject({applied:1,appliedIds:["0008_account_name_edit"],deferredIds:optional.map(m=>m.id),installedOptionalIds:[]});
  expect(await migrate(db as never,all,[])).toMatchObject({applied:0,appliedIds:[]});
  for(const m of all.filter(m=>m.requirement==="billing"))expect(db.query.mock.calls.some(([sql])=>sql===m.sql)).toBe(false);
 });
 it("billing selection applies the complete manifest in order",async()=>{
  const db=database();expect((await migrate(db as never,await loaded(),["billing"])).appliedIds).toEqual(MIGRATIONS.map(m=>m.id));
 });
 it("corrupt disabled SQL fails before connection",async()=>{
  const all=(await loaded()).map(m=>m.requirement==="billing"?{...m,sql:m.sql+"\n"}:m),db=database();
  await expect(migrate(db as never,all,[])).rejects.toThrow("migration_failed");expect(db.connect).not.toHaveBeenCalled();
 });
 it("corrupt installed optional history fails before applying any SQL",async()=>{
  const all=await loaded(),db=database([...rows(core),{id:optional[0].id,checksum:"0".repeat(64)}]);
  await expect(migrate(db as never,all,[])).rejects.toThrow("migration_failed");for(const item of all)expect(db.query.mock.calls.some(([sql])=>sql===item.sql)).toBe(false);
  expect(db.query).toHaveBeenCalledWith("ROLLBACK");expect(db.release).toHaveBeenCalledOnce();
 });
 it("SQL failure rolls back, releases lock and never reports completion",async()=>{
  const all=await loaded(),db=database([],all[0].sql);
  await expect(migrate(db as never,all,[])).rejects.toThrow(/^migration_failed$/);
  expect(db.query).toHaveBeenCalledWith("ROLLBACK");expect(db.query.mock.calls.at(-1)![0]).toContain("pg_advisory_unlock");expect(db.release).toHaveBeenCalledOnce();
 });
 it("verifies actual final history before commit",async()=>{
  const db=database();db.query.mockImplementation(async()=>({rows:[]}));
  await expect(migrate(db as never,await loaded(),[])).rejects.toThrow("migration_failed");expect(db.query).not.toHaveBeenCalledWith("COMMIT");
 });
 it("core after deferred billing is selected by metadata without enabling an undeclared dependency",async()=>{
  const all=await loaded(),sql="SELECT 1;",later={id:"9000_independent_core",file:"9000_independent_core.sql",requirement:"core" as const,checksum:createHash("sha256").update(sql).digest("hex"),sql};
  const db=database();const result=await migrate(db as never,[...all,later],[]);
  expect(result.appliedIds).toEqual([...core.map(m=>m.id),later.id]);expect(result.deferredIds).toEqual(optional.map(m=>m.id));
 });
});
const c={controlApi:"control",resourceGroup:"group"};
const env=(entries:unknown[]=[])=>JSON.stringify([{env:entries}]);
const enabledTest={NODE_ENV:"test",CW_BILLING_ENABLED:"true",CW_BILLING_MODE:"test",CW_STRIPE_ACCOUNT_ID:"acct_fixture",CW_STRIPE_PRODUCT_ID:"prod_fixture",CW_STRIPE_PRICE_ID:"price_fixture",CW_STRIPE_PORTAL_CONFIGURATION_ID:"bpc_fixture",STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_WEBHOOK_SECRET:"whsec_fixture"};
describe("target configuration and sanitized migration evidence",()=>{
 it("uses existing billingConfig policy, including production rejection",()=>{
  expect(controlRequirements({NODE_ENV:"production"})).toBe("core");expect(controlRequirements(enabledTest)).toBe("core,billing");
  expect(()=>controlRequirements({...enabledTest,NODE_ENV:"production"})).toThrow();expect(()=>controlRequirements({...enabledTest,CW_BILLING_ENABLED:"yes"})).toThrow();
 });
 it.each(["core","core,billing"])("renders exact CLI selection %s",async selection=>{
  const plan=await migrationPlan(selection);expect(migrationJobArgs(plan)).toEqual(["dist/database/cli.js",selection]);expect(plan.requirements).toEqual(selection.split(","));
 });
 it("reads only feature fields and rejects ambiguous/secretRef/invalid target settings",async()=>{
  const call=vi.fn(async()=>env());expect(await readControlRequirements(call,c)).toBe("core");
  expect(call.mock.calls[0]).toBeDefined();
  for(const value of ["{}","[]",JSON.stringify([{env:[]},{env:[]}]),env([{name:"CW_BILLING_ENABLED",secretRef:"not-readable"}]),env([{name:"CW_BILLING_ENABLED",value:"false"},{name:"CW_BILLING_ENABLED",value:"false"}]),env([{name:"CW_BILLING_ENABLED",value:"true"}]),env([{name:"NODE_ENV",value:"test"}])])await expect(readControlRequirements(async()=>value,c)).rejects.toThrow();
 });
 it("detects feature or manifest plan drift",async()=>{
  const plan=await migrationPlan("core");await expect(verifyControlRequirements(async()=>env(),c,plan)).resolves.toBeUndefined();
  for(const altered of [{...plan,selection:"core,billing"},{...plan,manifestFingerprint:"0".repeat(64)},undefined])await expect(verifyControlRequirements(async()=>env(),c,altered)).rejects.toThrow("control_features_changed");
 });
 it("records only exact allowlisted completion metadata from direct or ARM-wrapped logs",async()=>{
  const plan=await migrationPlan("core"),result={requirements:["core"],applied:0,appliedIds:[],deferredIds:plan.optionalIds,installedOptionalIds:[]};
  const event={event:"migration.completed",...result,secretCanary:"never-retain"};
  for(const log of [JSON.stringify(event),JSON.stringify({Log:JSON.stringify(event),TimeStamp:"ignored"})])expect(migrationCompletion(log,plan)).toEqual(result);
  for(const log of ["no result",JSON.stringify(event)+"\n"+JSON.stringify(event),JSON.stringify({...event,requirements:["core","billing"]}),JSON.stringify({...event,appliedIds:[plan.optionalIds[0]],applied:1}),JSON.stringify({...event,deferredIds:[]})])expect(()=>migrationCompletion(log,plan)).toThrow("migration_result_unproven");
 });
});
afterEach(()=>{vi.restoreAllMocks();});

// Compatibility approval is not execution authority: the runner never uses the runtime catalog.
describe('strict execution with approved forward runtime history',()=>{
 it('Release A execution package rejects installed 0008 without executing or reconciling it',async()=>{
  const {MIGRATIONS}=await import('../database/migrationManifest.js');
  const loaded=(await loadMigrations(MIGRATIONS,new URL('../../database/migrations/',import.meta.url))).filter(m=>m.id!=='0008_account_name_edit');
  const query=vi.fn(async()=>({rows:MIGRATIONS.map(({id,checksum})=>({id,checksum}))}));
  await expect(migrate({connect:async()=>({query,release:()=>{}})} as never,loaded,[])).rejects.toThrow('migration_failed');
  expect(query.mock.calls.some(c=>(c as unknown as [string])[0]==='ROLLBACK')).toBe(true);
  expect(query.mock.calls.some(c=>loaded.some(m=>m.sql===(c as unknown as [string])[0]))).toBe(false);
 });
});
