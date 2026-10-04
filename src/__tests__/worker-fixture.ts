// Explicitly authenticated service configuration for existing wire-level tests.
import { createWorker } from "../worker.js";
import { buildConfig } from "../config.js";
export default { fetch(request: Request, env: Record<string, string | undefined>) {
  const configured = env.AUTH_MODE === "gateway";
  const clean = new Request(request, { headers: Object.fromEntries([...request.headers].filter(([name]) => !name.startsWith("x-cw-"))) });
  return createWorker({ authenticate: async () => true, configProvider: () => configured ? buildConfig("acme", "pub", "priv", "client-guid").config! : null }).fetch(clean, {});
} };
