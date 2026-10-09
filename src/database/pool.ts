import { Pool } from "pg";
import type { Environment } from "../config.js";
import { createAzureSecretReader, type SecretReaderFactory } from "../config-loader.js";
import { databaseConfig } from "./config.js";
export function databasePool(env: Environment, factory: SecretReaderFactory = createAzureSecretReader): Pool {
    const config = databaseConfig(env);
    let reader: ReturnType<SecretReaderFactory> | undefined;
    const pool = new Pool({ host: config.host, database: config.database, user: config.user, port: config.port,
        ssl: config.local ? false : { rejectUnauthorized: true }, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
        password: config.local ? config.localPassword : async () => {
            reader ??= factory(config.vaultUri!, env);
            try {
                const password = await (await reader)(config.passwordSecret!);
                if (!password)
                    throw new Error();
                return password;
            }
            catch {
                reader = undefined;
                throw new Error("database_credentials_unavailable");
            }
        } });
    pool.on("error", () => console.error(JSON.stringify({ event: "control.database_unavailable" })));
    return pool;
}
