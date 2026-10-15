import { ManagedIdentityCredential } from "@azure/identity";
import type { MigrationContext } from "./migrationBreadcrumb.js";
export interface ReceiptStore { account: string; container: string }
export function receiptStore(value: unknown): ReceiptStore {
    const c = value as ReceiptStore;
    if (!c || Object.keys(c).sort().join() !== "account,container" || typeof c.account !== "string" || !/^[a-z0-9]{3,24}$/.test(c.account) ||
        typeof c.container !== "string" || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(c.container) || c.container.includes("--")) throw new Error("migration_store_invalid");
    return c;
}
export function storeFromEnvironment(env: NodeJS.ProcessEnv): ReceiptStore {
    try { return receiptStore(JSON.parse(Buffer.from(env.CW_MIGRATION_RECEIPT_STORE || "", "base64url").toString("utf8"))); }
    catch { throw new Error("migration_store_invalid"); }
}
export function receiptUrl(store: ReceiptStore, context: MigrationContext, execution: string, phase: "start" | "completion"): string {
    receiptStore(store);
    if (!/^[a-z0-9-]{1,128}$/.test(execution) || !["start","completion"].includes(phase)) throw new Error("invalid_execution");
    // Context is independently validated by the producer/coordinator; encode each path segment defensively.
    const path = ["v1",context.sha,context.run,context.attempt,context.request,execution,phase+".json"].map(encodeURIComponent).join("/");
    return `https://${store.account}.blob.core.windows.net/${store.container}/${path}`;
}
export async function createReceipt(url: string, body: string, token: string, request: typeof fetch = fetch): Promise<void> {
    let status: number;
    try {
        const response = await request(url, {method:"PUT",redirect:"error",signal:AbortSignal.timeout(30000),headers:{
            Authorization:`Bearer ${token}`,"x-ms-version":"2023-11-03","x-ms-date":new Date().toUTCString(),
            "x-ms-blob-type":"BlockBlob","If-None-Match":"*","Content-Type":"application/json"},body});
        status = response.status;
        await response.body?.cancel();
    } catch { throw new Error("migration_receipt_publish_failed"); }
    if (status === 409 || status === 412) throw new Error("migration_receipt_conflict");
    if (status !== 201) throw new Error("migration_receipt_publish_failed");
}
export async function publishReceipt(event: {context:MigrationContext;execution:string;event:string}, env = process.env): Promise<void> {
    const store = storeFromEnvironment(env);
    let token: string;
    try {
        const access = await new ManagedIdentityCredential().getToken("https://storage.azure.com/.default");
        if (!access?.token) throw new Error();
        token = access.token;
    } catch { throw new Error("migration_receipt_publish_failed"); }
    await createReceipt(receiptUrl(store,event.context,event.execution,event.event === "migration.start" ? "start" : "completion"),JSON.stringify(event),token);
}
