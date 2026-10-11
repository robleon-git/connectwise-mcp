import {afterEach,describe,expect,it,vi} from "vitest";
import {databasePool,MCP_DATABASE_LIMITS} from "../database/pool.js";
import {AccountAccessStore,createCustomerConfigProvider} from "../auth/customer-access.js";
import {withCustomerEvidence,customerAccessOutcome} from "../auth/customer-evidence.js";
const env={NODE_ENV:"test",CW_DB_LOCAL_TEST:"true",CW_DB_HOST:"127.0.0.1",CW_DB_NAME:"connectwise",CW_DB_USER:"cw_mcp",CW_DB_LOCAL_PASSWORD:"synthetic-local-only"};
afterEach(()=>vi.restoreAllMocks());
describe("MCP-only PostgreSQL runtime limits",()=>{
 it("sets per-connection statement/lock deadlines and a longer client query deadline",async()=>{
  const pool=databasePool(env);try{expect(pool.options).toMatchObject({...MCP_DATABASE_LIMITS,max:3,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});expect(MCP_DATABASE_LIMITS).toEqual({statement_timeout:5000,lock_timeout:2000,query_timeout:6000});}finally{await pool.end();}
 });
 it.each(["cw_control","cw_migrator"])("leaves %s behavior untouched",async user=>{
  const pool=databasePool({...env,CW_DB_USER:user});try{expect(pool.options.statement_timeout).toBeUndefined();expect(pool.options.lock_timeout).toBeUndefined();expect(pool.options.query_timeout).toBeUndefined();}finally{await pool.end();}
 });
 it.each(["57014","55P03","network_timeout"])("%s fails closed before vault or CW",async code=>{
  const logs=vi.spyOn(console,"error").mockImplementation(()=>{}),read=vi.fn(),send=vi.fn();
  const query=vi.fn(async()=>{throw Object.assign(new Error("DO-NOT-LOG-SQL-CREDENTIAL"),{code});});
  await withCustomerEvidence({},async()=>{try{await createCustomerConfigProvider(new AccountAccessStore({query} as never,"https://issuer.example"),{read})({issuer:"https://issuer.example",subject:"synthetic-subject"});}catch(error){customerAccessOutcome("service_unavailable");expect((error as Error).message).toBe("service_unavailable");}});
  expect(read).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();expect(JSON.stringify(logs.mock.calls)).not.toContain("DO-NOT-LOG");
  expect(JSON.parse(String(logs.mock.calls[0][0]))).toMatchObject({outcome:"service_unavailable",customerSecretGetAttempts:0,connectWiseGetAttempts:0});
 });
 it.each([1,2,3])("database uncertainty at lookup %s cannot reach credentials",async stage=>{
  const read=vi.fn(),uid="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",aid="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";let step=0;
  const query=vi.fn(async()=>{if(++step===stage)throw new Error("synthetic-timeout");return {rows:step===1?[{user_id:uid,account_id:aid}]:[{source:"trial",status:"active",starts_at:new Date(0),ends_at:new Date(Date.now()+10000),evaluated_at:new Date()}]};});
  await expect(createCustomerConfigProvider(new AccountAccessStore({query} as never,"https://issuer.example"),{read})({issuer:"https://issuer.example",subject:"synthetic-subject"})).rejects.toThrow("service_unavailable");expect(read).not.toHaveBeenCalled();expect(query).toHaveBeenCalledTimes(stage);
 });

});
