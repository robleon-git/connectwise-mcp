import { customerEvidence } from "./customerEvidence.js";
import { databasePool } from "./pool.js";
import { loadMigrations, migrate } from "./migrationRunner.js";
import { MIGRATIONS } from "./migrationManifest.js";
let pool: ReturnType<typeof databasePool> | undefined;
try {
    if (process.env.NODE_ENV === "production" && (process.env.CW_DB_USER !== "cw_migrator" || process.env.CW_DB_PASSWORD_SECRET !== "cw-migration-db-password"))
        throw new Error();
    pool = databasePool(process.env);
    if (process.argv.length === 3 && process.argv[2] === "--verify-slice1") {
        console.log(JSON.stringify(await customerEvidence(pool)));
    } else {
        if (process.argv.length !== 2) throw new Error();
        const migrations = await loadMigrations(MIGRATIONS, new URL("../../database/migrations/", import.meta.url));
        console.log(JSON.stringify({ event: "migration.completed", ...await migrate(pool, migrations) }));
    }
}
catch {
    console.error(JSON.stringify({ event: "migration.failed" }));
    process.exitCode = 1;
}
finally {
    await pool?.end();
}
