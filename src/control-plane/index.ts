import { createServer } from "node:http";
import { databasePool } from "../database/pool.js";
import { MIGRATIONS } from "../database/migrationManifest.js";
import { createControlApi } from "./server.js";
let pool: ReturnType<typeof databasePool> | undefined;
try {
    if (process.env.CW_CUSTOMER_FEATURES_ENABLED && process.env.CW_CUSTOMER_FEATURES_ENABLED !== "false")
        throw new Error();
    if (process.env.NODE_ENV === "production" && (process.env.CW_DB_USER !== "cw_control" || process.env.CW_DB_PASSWORD_SECRET !== "cw-control-db-password"))
        throw new Error();
    const port = Number(process.env.CW_CONTROL_PORT || "8080");
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error();
    pool = databasePool(process.env);
    const db = pool;
    const { app, drain } = createControlApi(async () => {
        const result = await db.query<{
            id: string;
            checksum: string;
        }>("SELECT id, checksum FROM public.schema_migrations ORDER BY id");
        return MIGRATIONS.every(expected => result.rows.some(row => row.id === expected.id && row.checksum === expected.checksum));
    });
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "0.0.0.0", resolve); });
    console.error(JSON.stringify({ event: "control.started" }));
    for (const signal of ["SIGTERM", "SIGINT"])
        process.once(signal, () => {
            drain();
            server.close(() => { void db.end().then(() => process.exit(0)).catch(() => process.exit(1)); });
            setTimeout(() => process.exit(1), 10000).unref();
        });
}
catch {
    console.error(JSON.stringify({ event: "control.start_failed" }));
    await pool?.end();
    process.exitCode = 1;
}
