import { AsyncLocalStorage } from "node:async_hooks";
import { diagnosticRequestId } from "../diagnostics.js";
const outcomes = ["authentication_denied", "request_denied", "access_denied", "setup_required", "service_unavailable", "authorized"] as const;
type Outcome = typeof outcomes[number];
interface Evidence { requestId: string; outcome: Outcome; customerSecretGetAttempts: number; connectWiseGetAttempts: number }
const context = new AsyncLocalStorage<Evidence>();
/** Server-created correlation only. No identity, parameters, URLs, references or payloads accepted. */
export async function withCustomerEvidence<T>(request: object, operation: () => Promise<T>): Promise<T> {
  const evidence: Evidence = {requestId:diagnosticRequestId(request),outcome:"authentication_denied",customerSecretGetAttempts:0,connectWiseGetAttempts:0};
  return context.run(evidence,async()=>{
    try {return await operation();}
    finally {console.error(JSON.stringify({event:"mcp.access_evidence",requestId:evidence.requestId,outcome:evidence.outcome,
      customerSecretGetAttempts:evidence.customerSecretGetAttempts,connectWiseGetAttempts:evidence.connectWiseGetAttempts}));}
  });
}
export function customerAccessOutcome(outcome: Outcome): void {
  const evidence=context.getStore();
  if(evidence) evidence.outcome=outcomes.includes(outcome)?outcome:"service_unavailable";
}
export function customerSecretGetAttempt(): void { const evidence=context.getStore();if(evidence) evidence.customerSecretGetAttempts=Math.min(evidence.customerSecretGetAttempts+1,1000000); }
export function connectWiseGetAttempt(): void { const evidence=context.getStore();if(evidence) evidence.connectWiseGetAttempts=Math.min(evidence.connectWiseGetAttempts+1,1000000); }
