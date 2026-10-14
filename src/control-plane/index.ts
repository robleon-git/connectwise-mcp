import { billingConfig } from "../billing/config.js";
import { BillingStore } from "../billing/store.js";
import { BillingService } from "../billing/service.js";
import { StripeBillingProvider } from "../billing/stripe.js";
import { billingCustomerRoutes,billingWebhookRoutes } from "../billing/routes.js";
import { billingWorker } from "../billing/worker.js";
import { createServer } from "node:http";
import { databasePool } from "../database/pool.js";
import { MIGRATIONS } from "../database/migrationManifest.js";
import { ConnectionStore } from "../connections/store.js";
import { ConnectionService } from "../connections/service.js";
import { CustomerStore } from "./auth/store.js";
import { microsoftProvider } from "./auth/microsoft.js";
import { mcpLinkProvider } from "./auth/mcp-link-provider.js";
import { McpLinkStore } from "./auth/mcp-link-store.js";
import { mcpLinkRoutes } from "./auth/mcp-link-routes.js";
import { customerRoutes } from "./auth/routes.js";
import { createControlApi } from "./server.js";
let pool: ReturnType<typeof databasePool> | undefined;
try {
    const billingSettings=billingConfig(process.env);
    if(billingSettings && process.env.CW_CUSTOMER_FEATURES_ENABLED!=="true")throw new Error();
    if (process.env.CW_CUSTOMER_FEATURES_ENABLED && !["false", "true"].includes(process.env.CW_CUSTOMER_FEATURES_ENABLED))
        throw new Error();
    if (process.env.NODE_ENV === "production" && (process.env.CW_DB_USER !== "cw_control" || process.env.CW_DB_PASSWORD_SECRET !== "cw-control-db-password"))
        throw new Error();
    const port = Number(process.env.CW_CONTROL_PORT || "8080");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error();
    pool = databasePool(process.env);
    const db = pool;
    if(process.env.CW_CONNECTION_SETUP_ENABLED && !["true","false"].includes(process.env.CW_CONNECTION_SETUP_ENABLED))throw new Error();
    if(process.env.CW_CONNECTION_SETUP_ENABLED==="true" && process.env.CW_CUSTOMER_FEATURES_ENABLED!=="true")throw new Error();
    const browser = process.env.CW_CUSTOMER_FEATURES_ENABLED === "true" ? await microsoftProvider(process.env) : undefined;
    if (process.env.CW_MCP_LINKING_ENABLED && !["true","false"].includes(process.env.CW_MCP_LINKING_ENABLED)) throw new Error();
    if (process.env.CW_MCP_LINKING_ENABLED === "true" && !browser) throw new Error();
    const linking = process.env.CW_MCP_LINKING_ENABLED === "true" ? await mcpLinkProvider(process.env) : undefined;
    const customers = new CustomerStore(db);
    const billing=billingSettings ? new BillingService(billingSettings,new BillingStore(db),new StripeBillingProvider(billingSettings)) : undefined;
    const ai = linking && browser ? mcpLinkRoutes(customers,new McpLinkStore(db,linking.resource.issuer),linking.provider,browser.flowKey) : undefined;
    const customer = browser ? customerRoutes(new CustomerStore(db), browser.provider, browser.flowKey,{service:new ConnectionService(new ConnectionStore(db)),enabled:process.env.CW_CONNECTION_SETUP_ENABLED==="true"},ai,billing ? billingCustomerRoutes(customers,billing) : undefined) : undefined;
    const { app, drain } = createControlApi(async () => {
        const result = await db.query<{
            id: string;
            checksum: string;
        }>("SELECT id, checksum FROM public.schema_migrations ORDER BY id");
        return MIGRATIONS.every(expected => result.rows.some(row => row.id === expected.id && row.checksum === expected.checksum));
    }, customer,billing ? billingWebhookRoutes(billing) : undefined);
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "0.0.0.0", resolve); });
    const worker=billing ? billingWorker(billing) : undefined;
    console.error(JSON.stringify({ event: "control.started" }));
    for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () => {
            drain();
            server.close(() => { void (worker?.stop()??Promise.resolve()).then(()=>db.end()).then(() => process.exit(0)).catch(() => process.exit(1)); });
            setTimeout(() => process.exit(1), 10000).unref();
        });
}
catch {
    console.error(JSON.stringify({ event: "control.start_failed" }));
    await pool?.end();
    process.exitCode = 1;
}
