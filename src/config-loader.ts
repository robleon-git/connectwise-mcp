import { getConfig, validateConfig, type ConfigProvider, type CwManageConfig, type Environment } from "./config.js";
import { ConfigurationError } from "./diagnostics.js";

export const CW_VAULT_SECRETS = Object.freeze({ publicKey: "connectwise-public-key", privateKey: "connectwise-private-key" });
/** Noncredential sentinel for operator-created placeholder secrets; never sent to CW. */
export const CW_UNCONFIGURED_PLACEHOLDER = "__CONNECTWISE_NOT_CONFIGURED__";
export type SecretReader = (name: string) => Promise<string | undefined>;
export type SecretReaderFactory = (vaultUri: string, env: Environment) => Promise<SecretReader>;

export async function createAzureSecretReader(vaultUri: string, env: Environment): Promise<SecretReader> {
  const [{ SecretClient, logger: secretLogger }, { DefaultAzureCredential, ManagedIdentityCredential, logger: identityLogger }] = await Promise.all([
    import("@azure/keyvault-secrets"), import("@azure/identity"),
  ]);
  // Disable these packages' diagnostic sinks even if operator SDK debug logging
  // is enabled. Our own diagnostics remain fixed messages without Azure raw errors.
  for (const logger of [secretLogger, identityLogger]) {
    for (const level of ["error", "warning", "info", "verbose"] as const) logger[level].log = () => {};
  }
  // Hosted production cannot fall back to developer CLI or client-secret credentials.
  const credential = env.NODE_ENV === "production"
    ? new ManagedIdentityCredential({ loggingOptions: { logger: identityLogger.info,
      allowLoggingAccountIdentifiers: false, enableUnsafeSupportLogging: false } })
    : new DefaultAzureCredential({ loggingOptions: { logger: identityLogger.info,
      allowLoggingAccountIdentifiers: false, enableUnsafeSupportLogging: false } });
  const client = new SecretClient(vaultUri, credential, {
    retryOptions: { maxRetries: 2 },
    redirectOptions: { handleRedirects: false, maxRetries: 0 },
  });
  return async name => {
    try {
      const secret = await client.getSecret(name, { abortSignal: AbortSignal.timeout(10000) });
      return secret.value;
    } catch (error) {
      if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) return undefined;
      // Never expose Azure error bodies, headers, inner errors or token details.
      throw new ConfigurationError("cw-config-unavailable");
    }
  };
}

/** One normalized provider, used after HTTP authentication and by local stdio.
 * Vault values live only in memory for at most 60 seconds; no stale-on-error fallback.
 */
export function createConnectWiseConfigLoader({ env = process.env, createSecretReader = createAzureSecretReader,
  now = Date.now }: { env?: Environment; createSecretReader?: SecretReaderFactory; now?: () => number } = {}): ConfigProvider {
  const settings = Object.freeze({ ...env });
  const source = settings.CW_CONFIG_SOURCE || "env";
  let reader: Promise<SecretReader> | undefined;
  let cached: CwManageConfig | null | undefined;
  let expires = 0;
  let pending: Promise<CwManageConfig | null> | undefined;
  async function resolve(): Promise<CwManageConfig | null> {
    if (source === "env") return getConfig(settings);
    if (source !== "key-vault" || settings.CW_MANAGE_REJECT_UNAUTHORIZED === "false" ||
        settings.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new ConfigurationError("invalid-config");
    // Absent nonsecret deployment configuration preserves Stage A without vault I/O.
    const { CW_KEY_VAULT_URI: uri, CW_MANAGE_URL: baseUrl, CW_MANAGE_COMPANY_ID: companyId,
      CW_MANAGE_CLIENT_ID: clientId } = settings;
    if (!uri || !baseUrl || !companyId || !clientId) return null;
    let vault: URL;
    try {
      vault = new URL(uri);
      if (vault.protocol !== "https:" || vault.username || vault.password || vault.port || vault.search || vault.hash ||
          vault.pathname !== "/" || !/^[a-z][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(vault.hostname)) throw new Error();
      // Validate the nonsecret CW target before resolving any credential material.
      validateConfig({ baseUrl, companyId, clientId, publicKey: CW_UNCONFIGURED_PLACEHOLDER,
        privateKey: CW_UNCONFIGURED_PLACEHOLDER, rejectUnauthorized: true });
    } catch { throw new ConfigurationError("invalid-config"); }
    try {
      reader ??= createSecretReader(vault.origin, settings);
      const read = await reader;
      const [publicKey, privateKey] = await Promise.all([
        read(CW_VAULT_SECRETS.publicKey), read(CW_VAULT_SECRETS.privateKey),
      ]);
      if (!publicKey?.trim() || !privateKey?.trim() || publicKey.trim() === CW_UNCONFIGURED_PLACEHOLDER ||
          privateKey.trim() === CW_UNCONFIGURED_PLACEHOLDER) return null;
      return Object.freeze(validateConfig({ baseUrl, companyId, clientId, publicKey, privateKey, rejectUnauthorized: true }));
    } catch {
      reader = undefined;
      throw new ConfigurationError("cw-config-unavailable");
    }
  }
  return async () => {
    if (source === "env") return resolve(); // Preserve local environment-mode behavior.
    if (cached !== undefined && now() < expires) return cached;
    if (!pending) {
      // Clear expired credentials before reload. A lookup failure never uses old values.
      cached = undefined;
      pending = resolve().then(config => { cached = config; expires = now() + 60000; return config; });
    }
    try { return await pending; } finally { pending = undefined; }
  };
}
