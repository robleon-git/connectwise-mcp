import { customerEvidence } from "./customerEvidence.js";
import { databasePool } from "./pool.js";
import { loadMigrations, migrate, migrationFeatures } from "./migrationRunner.js";
import { MIGRATIONS } from "./migrationManifest.js";
let pool: ReturnType<typeof databasePool> | undefined;
try {
    if (process.env.NODE_ENV === "production" && (process.env.CW_DB_USER !== "cw_migrator" || process.env.CW_DB_PASSWORD_SECRET !== "cw-migration-db-password"))
        throw new Error();
    if (process.argv.length === 3 && process.argv[2] === "--verify-slice1") {
        pool = databasePool(process.env);
        console.log(JSON.stringify(await customerEvidence(pool)));
    } else {
        if (process.argv.length !== 3) throw new Error();
        const features = migrationFeatures(process.argv[2]);
        const migrations = await loadMigrations(MIGRATIONS, new URL("../../database/migrations/", import.meta.url));
        pool = databasePool(process.env);
        console.log(JSON.stringify({ event: "migration.completed", ...await migrate(pool, migrations, features) }));
    }
}
catch {
    console.error(JSON.stringify({ event: "migration.failed" }));
    process.exitCode = 1;
}
finally {
    await pool?.end();
}
