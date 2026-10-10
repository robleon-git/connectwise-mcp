// Narrow operator-only change to the existing shared routing resource, never to a Container App.
import { isDeepStrictEqual } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { az, configuration, assertSubscription } from "./common.mjs";
const routeUrl = "https://management.azure.com/subscriptions/08a97e42-1e1f-4f33-95dc-36af13337091/resourceGroups/monotorr-dev-eastus-rg/providers/Microsoft.App/managedEnvironments/monotorr-prod-aca-env/httpRouteConfigs/monotorr-api-routing?api-version=2025-07-01";
export const CONTROL_RULE = { description: "ConnectWise customer control API", routes: [
  { match: { path: "/connectwise/v1", caseSensitive: true }, action: {} },
  { match: { pathSeparatedPrefix: "/connectwise/v1", caseSensitive: true }, action: {} }
], targets: [{ containerApp: "connectwise-control-api" }] };
export function proposedRouting(properties) {
  if (!properties?.customDomains?.some(d => d.name === "api.monotorr.com" && d.bindingType === "SniEnabled") || properties.rules?.length !== 2) throw new Error("unexpected_live_routing");
  const [mcp, fallback] = properties.rules;
  if (JSON.stringify(mcp.targets) !== JSON.stringify([{ containerApp: "connectwise-mcp-pilot" }]) ||
      mcp.routes?.length !== 2 || mcp.routes[0].match?.path !== "/mcp" || mcp.routes[1].match?.path !== "/.well-known/oauth-protected-resource/mcp" ||
      JSON.stringify(fallback.targets) !== JSON.stringify([{ containerApp: "monotorr-api-prod" }]) ||
      fallback.routes?.length !== 1 || fallback.routes[0].match?.prefix !== "/") throw new Error("unexpected_live_routing");
  return { ...properties, rules: [mcp, CONTROL_RULE, fallback] };
}
export function matchingTarget(path, properties) {
  for (const rule of properties.rules) for (const route of rule.routes) {
    const m = route.match;
    if (m.path === path || (m.pathSeparatedPrefix && (path === m.pathSeparatedPrefix || path.startsWith(m.pathSeparatedPrefix + "/"))) ||
        (m.prefix && path.startsWith(m.prefix))) return rule.targets[0].containerApp;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const mode = process.argv[2]; if (process.argv.length !== 3 || !["plan", "apply", "rollback"].includes(mode)) throw new Error();
    await assertSubscription(await configuration());
    const live = JSON.parse(await az(["rest", "--method", "get", "--url", routeUrl, "-o", "json"]));
    // Only writable routing properties, no applications, traffic, DNS, secrets or certificate material.
    const current = { customDomains: live.properties.customDomains, rules: live.properties.rules };
    if (mode === "plan") {
      const after = proposedRouting(current);
      await mkdir(".delivery", { recursive: true });
      await writeFile(".delivery/customer-routing.json", JSON.stringify({ before: current, after }, null, 2) + "\n");
      console.log(JSON.stringify({ routingPlanPrepared: true, namespace: "/connectwise/v1", mcpRulesUnchanged: true, monotorrFallbackUnchanged: true }));
    } else {
      const { before, after } = JSON.parse(await readFile(".delivery/customer-routing.json", "utf8"));
      if (!isDeepStrictEqual(proposedRouting(before), after)) throw new Error();
      if (!isDeepStrictEqual(current, mode === "apply" ? before : after)) throw new Error();
      const target = mode === "apply" ? after : before;
      await az(["rest", "--method", "put", "--url", routeUrl, "--body", JSON.stringify({ properties: target }), "-o", "none"]);
      const verified = JSON.parse(await az(["rest", "--method", "get", "--url", routeUrl, "-o", "json"]));
      if (!isDeepStrictEqual({ customDomains: verified.properties.customDomains, rules: verified.properties.rules }, target)) throw new Error();
      console.log(JSON.stringify({ customerRoutingAction: mode, verified: true }));
    }
  } catch { console.error(JSON.stringify({ customerRoutingSucceeded: false, reason: "review_required" })); process.exitCode = 1; }
}
