import {afterEach,describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {MIGRATIONS,requiredMigrations,validateMigrationManifest,migrationHistoryReady,migrationReadiness,type Migration} from '../database/migrationManifest.js';
import {loadMigrations,migrate} from '../database/migrationRunner.js';
const core=MIGRATIONS.filter(m=>m.requirement==='core'),billing=MIGRATIONS.filter(m=>m.requirement==='billing');
const history=(items:readonly {id:string;checksum:string}[]=MIGRATIONS)=>items.map(({id,checksum})=>({id,checksum}));
describe('feature-scoped authoritative migration history',()=>{
 it('classifies core and billing once and selects by metadata rather than migration numbers',()=>{
  expect(core).toHaveLength(5);expect(billing.map(m=>m.id)).toEqual(['0006_test_billing_foundation','0007_test_billing_checkout']);
  expect(requiredMigrations()).toEqual(core);expect(requiredMigrations(['billing'])).toEqual(MIGRATIONS);
  const renamed:Migration[]=[{...core[0],id:'9000_core',file:'9000_core.sql'},{...billing[0],id:'9001_feature',file:'9001_feature.sql'}];expect(requiredMigrations([],renamed)).toEqual([renamed[0]]);
 });
 it('core-only history passes control/MCP disabled-feature verification; order is irrelevant',()=>{expect(migrationHistoryReady(history(core))).toBe(true);expect(migrationHistoryReady(history(core).reverse(),[])).toBe(true);expect(migrationHistoryReady(history())).toBe(true);});
 it.each(core.map(m=>m.id))('missing core %s fails even with billing disabled',id=>{expect(migrationHistoryReady(history().filter(m=>m.id!==id))).toBe(false);});
 it.each(billing.map(m=>m.id))('enabled billing requires %s',id=>{expect(migrationHistoryReady(history().filter(m=>m.id!==id),['billing'])).toBe(false);});
 it('enabled billing passes only with complete exact schema',()=>{expect(migrationHistoryReady(history(),['billing'])).toBe(true);expect(migrationHistoryReady(history(core),['billing'])).toBe(false);});
 it.each(MIGRATIONS.map(m=>m.id))('bad installed checksum for %s fails regardless of feature state',id=>{const rows=history().map(m=>m.id===id?{...m,checksum:'0'.repeat(64)}:m);expect(migrationHistoryReady(rows)).toBe(false);expect(migrationHistoryReady(rows,['billing'])).toBe(false);});
 it.each([null,{},'history',[{id:core[0].id,checksum:undefined}],[...history(core),history(core)[0]],[...history(core),{id:'9999_unknown',checksum:'a'.repeat(64)}]])('rejects malformed, ambiguous or unknown installed history %j',rows=>{expect(migrationHistoryReady(rows)).toBe(false);});
 it.each([undefined,null,'optional','CORE',false,[],{}])('rejects invalid/missing requirement %j',requirement=>{const manifest=[{...core[0],requirement}] as unknown as Migration[];expect(()=>validateMigrationManifest(manifest)).toThrow('invalid_migration_manifest');expect(migrationHistoryReady(history(core),[],manifest)).toBe(false);});
 it('rejects empty, duplicate, unsorted manifests and malformed features',()=>{
  for(const manifest of [[],[core[0],core[0]],[core[1],core[0]]])expect(()=>validateMigrationManifest(manifest)).toThrow();
  for(const features of [['billing','billing'],['unknown'],null])expect(migrationHistoryReady(history(),features as never)).toBe(false);
 });
 it('database failures and malformed query results fail closed without raw errors',async()=>{expect(await migrationReadiness({query:async()=>{throw new Error('synthetic-secret');}})).toBe(false);expect(await migrationReadiness({query:async()=>({rows:null})})).toBe(false);});
 it('the shared query validates optional installed history for both callers',async()=>{const db={query:vi.fn(async()=>({rows:history(core)}))};expect(await migrationReadiness(db)).toBe(true);expect(await migrationReadiness(db,['billing'])).toBe(false);expect(db.query).toHaveBeenCalledWith('SELECT id, checksum FROM public.schema_migrations ORDER BY id');});
 it('normal execution loads all SQL and applies every migration in manifest order',async()=>{
  const loaded=await loadMigrations(MIGRATIONS,new URL('../../database/migrations/',import.meta.url));expect(loaded).toHaveLength(7);
  const applied:string[]=[],query=vi.fn(async(sql:string,args?:unknown[])=>{if(sql.startsWith('INSERT INTO public.schema_migrations'))applied.push(args![0] as string);return{rows:history(loaded.filter(item=>applied.includes(item.id)))};}),release=vi.fn();
  expect(await migrate({connect:async()=>({query,release})} as never,loaded, ["billing"])).toMatchObject({applied:7});expect(applied).toEqual(MIGRATIONS.map(m=>m.id));expect(release).toHaveBeenCalledOnce();
 });
 it('execution rejects malformed metadata or changed SQL before connecting',async()=>{const loaded=await loadMigrations(MIGRATIONS,new URL('../../database/migrations/',import.meta.url));const connect=vi.fn();for(const bad of [[{...loaded[0],requirement:'unknown'}],[{...loaded[0],sql:'changed'}]])await expect(migrate({connect} as never,bad as never, ["billing"])).rejects.toThrow('migration_failed');expect(connect).not.toHaveBeenCalled();});
 it('execution rejects duplicate/unknown installed history without applying SQL',async()=>{const sql='SELECT 1;',manifest=[{id:'0001_example',file:'0001_example.sql',checksum:createHash('sha256').update(sql).digest('hex'),requirement:'core' as const,sql}];for(const rows of [[...history(manifest),...history(manifest)],[{id:'9999_unknown',checksum:'a'.repeat(64)}]]){const query=vi.fn(async()=>({rows}));await expect(migrate({connect:async()=>({query,release:()=>{}})} as never,manifest, ["billing"])).rejects.toThrow('migration_failed');expect(query.mock.calls.some(c=>(c as unknown as [string])[0]===sql)).toBe(false);}});
});

const mockPaths=['../database/pool.js','node:http','../diagnostics.js','../auth/descope-mcp.js','../http-server.js','../auth/customer-vault.js','../control-plane/server.js','../control-plane/auth/microsoft.js','../billing/service.js','../billing/store.js','../billing/stripe.js','../billing/routes.js','../billing/worker.js'];
afterEach(()=>{for(const p of mockPaths)vi.doUnmock(p);vi.unstubAllEnvs();vi.restoreAllMocks();vi.resetModules();});
async function startup(kind:'control'|'mcp',rows:unknown,enabled=false,dbFailure=false,nodeEnv='test') {
 vi.resetModules();const priorExit=process.exitCode;process.exitCode=undefined;
 const query=vi.fn(async()=>{if(dbFailure)throw new Error('synthetic-database-error');return{rows};}),end=vi.fn(async()=>{}),pool={query,end};
 vi.doMock('../database/pool.js',()=>({databasePool:()=>pool}));
 const listen=vi.fn((_port:unknown,_host:unknown,done:()=>void)=>done()),server={once:vi.fn(),listen,close:vi.fn(),on:vi.fn()};const createServer=vi.fn(()=>server);
 vi.doMock('node:http',()=>({createServer}));
 const log=vi.fn();vi.doMock('../diagnostics.js',()=>({logDiagnostic:log}));const error=vi.spyOn(console,'error').mockImplementation(()=>{});
 const originalOn=process.on.bind(process),originalOnce=process.once.bind(process);
 vi.spyOn(process,'on').mockImplementation(((event:Parameters<typeof process.on>[0],listener:Parameters<typeof process.on>[1])=>event==='SIGINT'||event==='SIGTERM'?process:originalOn(event,listener)) as typeof process.on);
 vi.spyOn(process,'once').mockImplementation(((event:Parameters<typeof process.once>[0],listener:Parameters<typeof process.once>[1])=>event==='SIGINT'||event==='SIGTERM'?process:originalOnce(event,listener)) as typeof process.once);
 for(const [key,value]of Object.entries({NODE_ENV:nodeEnv,MCP_TRANSPORT:'http',CW_DB_USER:kind==='mcp'?'cw_mcp':'cw_control',CW_DB_PASSWORD_SECRET:kind==='mcp'?'cw-mcp-db-password':'cw-control-db-password',CW_BILLING_ENABLED:enabled?'true':'false',CW_BILLING_MODE:'test',CW_CUSTOMER_FEATURES_ENABLED:'true',CW_CONNECTION_SETUP_ENABLED:'false',CW_MCP_LINKING_ENABLED:'false',CW_STRIPE_ACCOUNT_ID:'acct_fixture',CW_STRIPE_PRODUCT_ID:'prod_fixture',CW_STRIPE_PRICE_ID:'price_fixture',CW_STRIPE_PORTAL_CONFIGURATION_ID:'bpc_fixture',STRIPE_SECRET_KEY:'sk_test_syntheticFixtureOnly',STRIPE_WEBHOOK_SECRET:'whsec_syntheticFixtureOnly'}))vi.stubEnv(key,value);
 vi.stubEnv('CW_STRIPE_SECRET_KEY',undefined);vi.stubEnv('CW_STRIPE_WEBHOOK_SECRET',undefined);vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED',undefined);
 vi.doMock('../auth/descope-mcp.js',()=>({getDescopeResourceConfig:()=>({issuer:'https://identity.example'}),createPrincipalAuthenticator:()=>vi.fn()}));
 vi.doMock('../http-server.js',()=>({requireHttpAuthentication:()=>vi.fn(),createHttpHandler:()=>vi.fn()}));
 vi.doMock('../auth/customer-vault.js',()=>({managedCustomerCredentialReader:()=>({read:vi.fn()})}));
 const createApi=vi.fn(()=>({app:()=>{},drain:()=>{}}));vi.doMock('../control-plane/server.js',()=>({createControlApi:createApi}));
 vi.doMock('../control-plane/auth/microsoft.js',()=>({microsoftProvider:async()=>({provider:{},flowKey:new Uint8Array(32)})}));
 const service=vi.fn(class {}),store=vi.fn(class {}),provider=vi.fn(class {}),worker=vi.fn(()=>({stop:async()=>{}})),routes=vi.fn(()=>undefined);
 vi.doMock('../billing/service.js',()=>({BillingService:service}));vi.doMock('../billing/store.js',()=>({BillingStore:store}));vi.doMock('../billing/stripe.js',()=>({StripeBillingProvider:provider}));vi.doMock('../billing/worker.js',()=>({billingWorker:worker}));vi.doMock('../billing/routes.js',()=>({billingCustomerRoutes:routes,billingWebhookRoutes:routes}));
 try {if(kind==='mcp'){await import('../index.js');await vi.waitFor(()=>expect(log).toHaveBeenCalled());}else{await import('../control-plane/index.js');}return {query,end,listen,createServer,createApi,service,store,provider,worker,routes,log,error,exitCode:process.exitCode};}
 finally {process.exitCode=priorExit;}
}
describe('actual control and MCP entrypoint schema gates',()=>{
 it('control billing OFF passes readiness with core-only history and exposes no billing runtime',async()=>{const x=await startup('control',history(core));expect(x.listen).toHaveBeenCalledOnce();const check=(x.createApi.mock.calls[0] as unknown as [()=>Promise<boolean>])[0];expect(await check()).toBe(true);for(const f of [x.service,x.store,x.provider,x.worker,x.routes])expect(f).not.toHaveBeenCalled();expect(x.createApi.mock.calls[0]).toHaveLength(3);expect((x.createApi.mock.calls[0] as unknown[])[2]).toBeUndefined();});
 it('control core failure keeps readiness false without treating health as schema proof',async()=>{const x=await startup('control',history(core.slice(1)));const check=(x.createApi.mock.calls[0] as unknown as [()=>Promise<boolean>])[0];expect(await check()).toBe(false);expect(x.worker).not.toHaveBeenCalled();});
 it.each(billing.map(m=>m.id))('billing ON missing %s fails before constructing routes/services/worker or binding',async id=>{const x=await startup('control',history().filter(m=>m.id!==id),true);for(const f of [x.service,x.store,x.provider,x.worker,x.routes,x.createApi,x.createServer,x.listen])expect(f).not.toHaveBeenCalled();expect(x.end).toHaveBeenCalledOnce();expect(x.exitCode).toBe(1);});
 it('billing ON complete starts only after successful schema verification and shares the readiness gate',async()=>{const x=await startup('control',history(),true);expect(x.query).toHaveBeenCalledOnce();expect(x.service).toHaveBeenCalledOnce();expect(x.worker).toHaveBeenCalledOnce();expect(x.listen).toHaveBeenCalledOnce();expect(x.query.mock.invocationCallOrder[0]).toBeLessThan(x.service.mock.invocationCallOrder[0]);expect(await (x.createApi.mock.calls[0] as unknown as [()=>Promise<boolean>])[0]()).toBe(true);});
 it('billing ON query failure never partially exposes billing runtime',async()=>{const x=await startup('control',history(),true,true);expect(x.createServer).not.toHaveBeenCalled();expect(x.service).not.toHaveBeenCalled();expect(x.worker).not.toHaveBeenCalled();expect(x.exitCode).toBe(1);});
 it('invalid production billing enablement fails before querying schema or exposing runtime',async()=>{const x=await startup('control',history(),true,false,'production');expect(x.query).not.toHaveBeenCalled();expect(x.createServer).not.toHaveBeenCalled();expect(x.service).not.toHaveBeenCalled();expect(x.worker).not.toHaveBeenCalled();expect(x.exitCode).toBe(1);});
 it('MCP core-only startup opens its socket without any billing runtime even with a billing flag present',async()=>{const x=await startup('mcp',history(core),true);expect(x.listen).toHaveBeenCalledOnce();expect(x.log).toHaveBeenCalledWith('server.started');for(const f of [x.service,x.store,x.provider,x.worker,x.routes])expect(f).not.toHaveBeenCalled();});
 it.each(['missing-core','bad-core','bad-optional','duplicate','query-failure'])('MCP %s fails before creating/listening on a socket',async category=>{let rows=history();if(category==='missing-core')rows=rows.filter(m=>m.id!==core[0].id);if(category==='bad-core')rows[0].checksum='0'.repeat(64);if(category==='bad-optional')rows[rows.length-1].checksum='0'.repeat(64);if(category==='duplicate')rows.push(rows[0]);const x=await startup('mcp',rows,false,category==='query-failure');expect(x.createServer).not.toHaveBeenCalled();expect(x.listen).not.toHaveBeenCalled();expect(x.end).toHaveBeenCalledOnce();expect(x.log).toHaveBeenCalledWith('server.failed',expect.any(Error));expect(x.exitCode).toBe(1);});
});
