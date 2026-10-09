import type { Environment } from "../config.js";
export interface DatabaseConfig {
    host: string;
    database: string;
    user: string;
    port: number;
    vaultUri?: string;
    passwordSecret?: string;
    localPassword?: string;
    local: boolean;
}
export function databaseConfig(env: Environment): DatabaseConfig {
    const local = env.NODE_ENV !== "production" && env.CW_DB_LOCAL_TEST === "true";
    const host = env.CW_DB_HOST || "";
    const database = env.CW_DB_NAME || "";
    const user = env.CW_DB_USER || "";
    const port = Number(env.CW_DB_PORT || "5432");
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(database) || !/^[a-z][a-z0-9_]{0,62}$/.test(user) || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("invalid_database_configuration");
    if (local) {
        if (!["localhost", "127.0.0.1", "::1"].includes(host) || !env.CW_DB_LOCAL_PASSWORD)
            throw new Error("invalid_database_configuration");
        return { host, database, user, port, local, localPassword: env.CW_DB_LOCAL_PASSWORD };
    }
    if (!/^[a-z][a-z0-9-]+\.postgres\.database\.azure\.com$/.test(host) || port !== 5432 || env.CW_DB_LOCAL_PASSWORD || env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
        throw new Error("invalid_database_configuration");
    const passwordSecret = env.CW_DB_PASSWORD_SECRET;
    if (!["cw-control-db-password", "cw-migration-db-password"].includes(passwordSecret || ""))
        throw new Error("invalid_database_configuration");
    let vault: URL;
    try {
        vault = new URL(env.CW_KEY_VAULT_URI || "");
    }
    catch {
        throw new Error("invalid_database_configuration");
    }
    if (vault.protocol !== "https:" || !/^[a-z][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(vault.hostname) || vault.username || vault.password || vault.port || vault.search || vault.hash || vault.pathname !== "/")
        throw new Error("invalid_database_configuration");
    return { host, database, user, port, local, vaultUri: vault.origin, passwordSecret };
}
