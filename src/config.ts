import { ConfigurationError } from "./diagnostics.js";

export interface CwManageConfig {
  baseUrl: string;
  companyId: string;
  publicKey: string;
  privateKey: string;
  clientId: string;
  rejectUnauthorized?: boolean;
}

export type Environment = Readonly<Record<string, string | undefined>>;
/** Single boundary for environment or managed configuration. */
export type ConfigProvider = () => CwManageConfig | null | Promise<CwManageConfig | null>;

export function validateConfig(config: CwManageConfig): CwManageConfig {
  try {
    const url = new URL(config.baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        !config.companyId || !config.publicKey || !config.privateKey || !config.clientId) {
      throw new ConfigurationError("invalid-config");
    }
    return { ...config, baseUrl: config.baseUrl.replace(/\/+$/, "") };
  } catch {
    throw new ConfigurationError("invalid-config");
  }
}

export function getConfig(env: Environment = process.env): CwManageConfig | null {
  const companyId = env.CW_MANAGE_COMPANY_ID;
  const publicKey = env.CW_MANAGE_PUBLIC_KEY;
  const privateKey = env.CW_MANAGE_PRIVATE_KEY;
  const clientId = env.CW_MANAGE_CLIENT_ID;
  if (!companyId || !publicKey || !privateKey || !clientId) return null;
  return validateConfig({
    companyId, publicKey, privateKey, clientId,
    baseUrl: env.CW_MANAGE_URL || "https://api-na.myconnectwise.net",
    rejectUnauthorized: env.CW_MANAGE_REJECT_UNAUTHORIZED !== "false",
  });
}

export function buildConfig(
  companyId: string | undefined, publicKey: string | undefined,
  privateKey: string | undefined, clientId: string | undefined, baseUrl?: string,
): { config?: CwManageConfig; error?: string } {
  if (!companyId || !publicKey || !privateKey || !clientId) return { error: "Missing ConnectWise credentials" };
  try {
    return { config: validateConfig({ companyId, publicKey, privateKey, clientId,
      baseUrl: baseUrl || "https://api-na.myconnectwise.net" }) };
  } catch {
    return { error: "Invalid ConnectWise configuration" };
  }
}

// Kept for transport-neutral regression fixtures. The production Node HTTP
// entry point rejects gateway mode; credentials belong to the service.
export function resolveGatewayConfig(getHeader: (name: string) => string | undefined) {
  return buildConfig(getHeader("x-cw-company-id"), getHeader("x-cw-public-key"),
    getHeader("x-cw-private-key"), getHeader("x-cw-client-id"), getHeader("x-cw-url"));
}
