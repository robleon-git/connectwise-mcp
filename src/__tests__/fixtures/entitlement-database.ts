import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { migrate, type Migration } from "../../database/migrationRunner.js";
import { evaluateEntitlements, VALID_ENTITLEMENT_SQL, ENTITLEMENT_COLUMNS_SQL } from "../../entitlements/service.js";
import { ENTITLEMENT_CASES, EVALUATED_AT } from "./entitlement-cases.js";
/** All mutations below are isolated disposable-database fixtures, never a live billing writer. */
export async function verifyEntitlementDatabase(control: Pool,migrator: Pool,migrations: readonly (Migration & {sql:string})[]) {
 const accountId=(await control.query("SELECT id FROM public.accounts LIMIT 1")).rows[0].id;
 const ids=[randomUUID(),randomUUID()];
 for(const [i,status]of ["active","canceled"].entries()) await control.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,'web_paid',$3,now(),NULL)",[ids[i],accountId,status]);
 await expect(migrate(migrator,migrations, ["billing"])).rejects.toThrow("migration_failed");
 expect((await control.query("SELECT id FROM public.entitlements WHERE id=ANY($1::uuid[])",[ids])).rows).toHaveLength(2);
 expect((await control.query("SELECT id FROM public.schema_migrations WHERE id='0005_web_paid_entitlement'")).rows).toHaveLength(0);
 await migrator.query("DELETE FROM public.entitlements WHERE id=ANY($1::uuid[])",[ids]);
 expect((await migrate(migrator,migrations, ["billing"])).applied).toBe(1);
 for(const source of ["trial","web_paid","comp","substack"]){
  const insert=()=>control.query("INSERT INTO public.entitlements(id,account_id,source,status,starts_at,ends_at) VALUES($1,$2,$3,'active',now(),NULL)",[randomUUID(),accountId,source]);
  if(source==="trial") await expect(insert()).rejects.toMatchObject({code:"23505"});
  else {await insert();if(source==="web_paid")await expect(insert()).rejects.toMatchObject({code:"23505"});else await insert();}
 }
 await expect(control.query("UPDATE public.entitlements SET status='canceled' WHERE source='web_paid'")).rejects.toThrow();
 await expect(control.query("DELETE FROM public.entitlements WHERE source='web_paid'")).rejects.toThrow();
 await migrator.query("DELETE FROM public.entitlements WHERE account_id=$1 AND source<>'trial'",[accountId]);
 // Compare the shared SQL predicate and JS model at identical times, including infinite PG timestamps.
 const timestamp=(v:unknown)=>v===null?null:v instanceof Date&&Number.isFinite(v.getTime())?v.toISOString():"infinity";
 for(const {rows,allowed}of ENTITLEMENT_CASES){let sqlAllowed=false;
  for(const row of rows){const r=await control.query(`SELECT (${VALID_ENTITLEMENT_SQL.replaceAll("statement_timestamp()","$5::timestamptz")}) AS allowed
   FROM (SELECT $1::text AS source,$2::text AS status,$3::timestamptz AS starts_at,$4::timestamptz AS ends_at) e`,[row.source,row.status,timestamp(row.starts_at),timestamp(row.ends_at),EVALUATED_AT]);sqlAllowed ||= r.rows[0].allowed===true;}
  expect(sqlAllowed).toBe(allowed);expect(evaluateEntitlements(rows).allowed).toBe(sqlAllowed);
 }
 // SQL results retain microsecond boundaries after pg has parsed timestamps into JS Dates.
 for(const delta of [-0.0001,0,0.0001]){
  const time="2026-10-13T12:00:00.000150Z";
  const r=await control.query(`SELECT ${ENTITLEMENT_COLUMNS_SQL.replaceAll("statement_timestamp()","$1::timestamptz")} FROM
    (SELECT 'comp'::text source,'active'::text status,$1::timestamptz-interval '1 day' starts_at,
    $1::timestamptz+($2::double precision*interval '1 second') ends_at) e`,[time,delta]);
  expect(evaluateEntitlements(r.rows).allowed).toBe(delta>0);
 }
 // Rechecks must observe new statement time even inside one long transaction.
 const c=await migrator.connect();try{await c.query("BEGIN");const time=(await c.query("SELECT statement_timestamp() AS t")).rows[0].t;
  await c.query("SELECT pg_sleep(0.04)");const r=await c.query(`SELECT (${VALID_ENTITLEMENT_SQL}) AS allowed FROM
   (SELECT 'web_paid'::text source,'active'::text status,$1::timestamptz starts_at,$2::timestamptz ends_at) e`,[new Date(time.getTime()-1000),new Date(time.getTime()+20)]);
  expect(r.rows[0].allowed).toBe(false);await c.query("ROLLBACK");}finally{c.release();}
}
