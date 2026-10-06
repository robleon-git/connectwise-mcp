/**
 * ConnectWise Manage API Client
 *
 * Fetch-based HTTP client that handles authentication, pagination,
 * and self-signed certificate support for both cloud and self-hosted instances.
 *
 * Environment variables:
 *   CW_MANAGE_URL              - API base URL (e.g. https://api-na.myconnectwise.net)
 *   CW_MANAGE_COMPANY_ID       - Company identifier
 *   CW_MANAGE_PUBLIC_KEY        - API member public key
 *   CW_MANAGE_PRIVATE_KEY       - API member private key
 *   CW_MANAGE_CLIENT_ID         - Optional operator-owned integration Client ID
 *   CW_MANAGE_REJECT_UNAUTHORIZED - Set to "false" to allow self-signed certs (default: "true")
 *
 * Self-signed certificate support is scoped to this client instance's own
 * requests via an undici Agent passed as fetch's `dispatcher` option -- NOT
 * via the process-global NODE_TLS_REJECT_UNAUTHORIZED env var, which would
 * affect every concurrent request in the process (including unrelated
 * tenants' cloud-hosted, fully-verified connections).
 */
import { Agent } from "undici";

import { validateConfig, type CwManageConfig } from "./config.js";
import { ApiRequestError, ConfigurationError } from "./diagnostics.js";
export { getConfig, type CwManageConfig } from "./config.js";

/**
 * Low-level API client for ConnectWise Manage REST API.
 */
export class CwManageClient {
  private readonly authHeader: string;
  private readonly clientId: string | undefined;
  private readonly apiBase: string;
  private readonly dispatcher: Agent | undefined;

  constructor(config: CwManageConfig) {
    config = validateConfig(config);
    // Auth: Basic base64("{companyId}+{publicKey}:{privateKey}")
    const credentials = `${config.companyId}+${config.publicKey}:${config.privateKey}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString("base64")}`;
    this.clientId = config.clientId;
    // Append the standard API path if the URL doesn't already contain it
    this.apiBase = config.baseUrl.includes("/v4_6_release/")
      ? config.baseUrl.replace(/\/+$/, "")
      : `${config.baseUrl}/v4_6_release/apis/3.0`;
    // Only build a custom dispatcher when relaxed TLS is explicitly requested.
    // Scoped to this client instance's own connections only -- never touches
    // process.env, so a self-hosted (self-signed) instance's relaxed TLS
    // verification can never bleed into a concurrent request against a
    // different (cloud, fully-verified) tenant's connection.
    //
    // The default (verified) path deliberately uses Node's built-in fetch
    // dispatcher: passing the standalone `undici` package's Agent to Node's
    // global fetch breaks every request when the bundled undici version is
    // incompatible with the one embedded in the running Node runtime.
    this.dispatcher =
      config.rejectUnauthorized === false
        ? new Agent({ connect: { rejectUnauthorized: false } })
        : undefined;
  }

  private defaultHeaders(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      ...(this.clientId ? { clientId: this.clientId } : {}),
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  /**
   * Make a request to the ConnectWise Manage API.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      params?: Record<string, string | number | undefined>;
    },
  ): Promise<T> {
    if (method !== "GET") throw new ConfigurationError("read-only");
    try {
      const url = new URL(`${this.apiBase}${path}`);

      if (options?.params) {
        for (const [key, value] of Object.entries(options.params)) {
          if (value !== undefined && value !== "") {
            url.searchParams.set(key, String(value));
          }
        }
      }

      const fetchOptions: RequestInit = {
        method,
        redirect: "error",
        headers: this.defaultHeaders(),
      };

      // Self-hosted instances with self-signed certificates: the dispatcher
      // built in the constructor (only when CW_MANAGE_REJECT_UNAUTHORIZED is
      // "false") scopes rejectUnauthorized to THIS client's connections only,
      // with no process-global state involved.
      //
      // Assigned via a cast rather than a typed `dispatcher` field on
      // fetchOptions: Node's global fetch/RequestInit types (from the
      // `undici-types` package bundled with @types/node) declare their own
      // `Dispatcher` interface, structurally incompatible with the standalone
      // `undici` package's `Dispatcher` -- a well-known dual-package hazard.
      // The value is fully compatible at runtime (Node's fetch is undici under
      // the hood); only the type-checker sees two different declarations.
      if (this.dispatcher) {
        (fetchOptions as { dispatcher?: unknown }).dispatcher = this.dispatcher;
      }

      if (options?.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      const response = await fetch(url.toString(), fetchOptions);

      if (!response.ok) {
        throw new ApiRequestError(response.status);
      }

      // Some endpoints return 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiRequestError) throw new ApiRequestError(error.status);
      throw new ApiRequestError();
    }
  }

  /** GET helper */
  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  /** POST helper */
  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  /** PATCH helper */
  async patch<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  /** DELETE helper. Manage returns 204 No Content on success. */
  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
