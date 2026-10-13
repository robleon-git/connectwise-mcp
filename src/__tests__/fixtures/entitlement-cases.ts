import type { EntitlementRow } from "../../entitlements/service.js";
export const EVALUATED_AT = new Date("2026-10-13T12:00:00Z");
export function grant(source: unknown = "trial", overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return { source, status: "active", starts_at: new Date("2026-10-01T00:00:00Z"), ends_at: new Date("2026-11-01T00:00:00Z"), evaluated_at: EVALUATED_AT, ...overrides };
}
const expired = () => grant("trial", { ends_at: new Date("2026-10-10T00:00:00Z") });
const canceled = () => grant("web_paid", { status: "canceled" });
export const ENTITLEMENT_CASES: { name: string; rows: EntitlementRow[]; allowed: boolean }[] = [
  { name: "A active trial", rows: [grant()], allowed: true },
  { name: "B active paid", rows: [grant("web_paid")], allowed: true },
  { name: "C trial plus paid", rows: [grant(),grant("web_paid")], allowed: true },
  { name: "D expired trial plus paid", rows: [expired(),grant("web_paid")], allowed: true },
  { name: "E trial plus canceled paid", rows: [grant(),canceled()], allowed: true },
  { name: "F expired trial plus canceled paid", rows: [expired(),canceled()], allowed: false },
  { name: "G comp plus canceled paid", rows: [grant("comp",{ends_at:null}),canceled()], allowed: true },
  { name: "H substack plus expired trial", rows: [grant("substack",{ends_at:null}),expired()], allowed: true },
  { name: "I malformed plus valid", rows: [grant("web_paid",{starts_at:new Date(NaN)}),grant()], allowed: true },
  { name: "empty", rows: [], allowed: false },
  { name: "exact start", rows: [grant("comp",{starts_at:EVALUATED_AT})], allowed: true },
  { name: "exclusive end", rows: [grant("comp",{ends_at:EVALUATED_AT})], allowed: false },
  { name: "future start", rows: [grant("comp",{starts_at:new Date("2026-10-14T00:00:00Z")})], allowed: false },
  { name: "indefinite paid", rows: [grant("web_paid",{ends_at:null})], allowed: true },
  { name: "invalid end", rows: [grant("comp",{ends_at:new Date(NaN)})], allowed: false },
  { name: "infinite start", rows: [grant("comp",{starts_at:-Infinity,ends_at:null})], allowed: false },
  { name: "infinite end", rows: [grant("comp",{ends_at:Infinity})], allowed: false },
  { name: "unknown source", rows: [grant("other")], allowed: false },
  ...["suspended","canceled","expired","unknown"].map(status=>({name:status,rows:[grant("comp",{status})],allowed:false})),
  { name: "reversed interval", rows: [grant("comp",{ends_at:new Date("2026-09-01T00:00:00Z")})], allowed: false },
  { name: "multiple valid nontrial", rows: [grant("comp"),grant("substack"),grant("web_paid")], allowed: true },
];
