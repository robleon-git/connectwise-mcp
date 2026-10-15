import { customerEvidence } from "./customerEvidence.js";
import { databasePool } from "./pool.js";
import { loadMigrations, migrate, migrationFeatures } from "./migrationRunner.js";
import { MIGRATIONS } from "./migrationManifest.js";
import { migrationContext, packageFingerprint, breadcrumb, emitBreadcrumb, type MigrationContext } from "./migrationBreadcrumb.js";
let context: MigrationContext | undefined;
let terminalPublicationAttempted = false;
let startPublished = false;
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
        context = migrationContext(process.env, process.argv[2]);
        if (context) { await emitBreadcrumb(breadcrumb(context, process.env.CONTAINER_APP_JOB_EXECUTION_NAME!, "start")); startPublished = true; }
        const migrations = await loadMigrations(MIGRATIONS, new URL("../../database/migrations/", import.meta.url));
        if (context && context.manifestFingerprint !== packageFingerprint(migrations)) throw new Error("migration_package_mismatch");
        pool = databasePool(process.env);
        const result = await migrate(pool, migrations, features);
        if (context) { terminalPublicationAttempted = true; await emitBreadcrumb(breadcrumb(context, process.env.CONTAINER_APP_JOB_EXECUTION_NAME!, "success", result)); }
        else console.log(JSON.stringify({ event: "migration.completed", ...result }));
    }
}
catch {
    if (context && startPublished && !terminalPublicationAttempted) await emitBreadcrumb(breadcrumb(context, process.env.CONTAINER_APP_JOB_EXECUTION_NAME!, "failure")).catch(() => {});
    console.error(JSON.stringify({ event: "migration.failed" }));
    process.exitCode = 1;
}
finally {
    try { await pool?.end(); } catch { process.exitCode = 1; }
}
