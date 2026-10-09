// Local operator workflow only. No service startup, deployment, configuration writes,
// user management, token persistence or external shell state required.
/* global process */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { setTimeout as wait } from "node:timers/promises";
import { runDiagnostic, main as safeDiagnosticMain, openDefaultBrowser } from "./validate-mcp-user-claim.mjs";
import { matchesReadToolInventory } from "./read-only-tool-inventory.mjs";

const execute = promisify(execFile);
const target = ["--name", "connectwise-mcp-pilot", "--resource-group", "monotorr-dev-eastus-rg"];
const reasons = new Set(["no_bearer_token", "malformed_bearer_token", "jwt_verification_failed",
  "issuer_validation_failed", "audience_validation_failed", "time_validation_failed", "required_claim_missing",
  "missing_scope", "approved_user_missing", "approved_user_mismatch", "authenticator_failed", "authentication_rejected"]);
const httpMethods = new Set(["POST", "GET", "DELETE", "OPTIONS", "HEAD", "PUT", "PATCH", "other"]);
const rpcMethods = new Set(["initialize", "notifications/initialized", "tools/list", "tools/call", "ping", "other"]);

/** Reconstruct only known primitive facts. Never print raw CLI lines or unknown fields. */
export function safeAzureEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      typeof input.requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) return undefined;
  const event = { event: input.event, requestId: input.requestId };
  if (input.event === "auth.accepted" || input.event === "auth.denied") {
    if (input.event === "auth.denied") {
      if (!reasons.has(input.reason)) return undefined;
      event.reason = input.reason;
    }
    if (input.claimPath === "/sub" || input.claimPath === "[configured]") event.claimPath = input.claimPath;
    return event;
  }
  if (input.event !== "mcp.request" && input.event !== "mcp.response") return undefined;
  if (!httpMethods.has(input.method) || input.path !== "/mcp") return undefined;
  event.method = input.method; event.path = "/mcp";
  if (input.event === "mcp.request") {
    if (!rpcMethods.has(input.rpcMethod)) return undefined;
    event.rpcMethod = input.rpcMethod;
  } else {
    if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599) return undefined;
    event.status = input.status;
  }
  return event;
}

export function filterAzureLogs(text) {
  const events = [];
  let visited = 0;
  function collect(value, depth = 0) {
    if (++visited > 10000 || depth > 8) return;
    if (Array.isArray(value)) { for (const item of value) collect(item, depth + 1); return; }
    if (typeof value === "string") {
      // Azure can wrap JSON in a CRI timestamp/stream/full-record prefix. Only
      // strip that known envelope, never search arbitrary body text for JSON.
      const cri = value.match(/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})\s+(?:stdout|stderr)\s+([FP])\s+([\s\S]*)$/);
      if (cri?.[1] === "P") return; // Partial fragments cannot safely establish an event.
      const message = cri ? cri[2] : value;
      try { collect(JSON.parse(message), depth + 1); } catch { /* Never echo message or parse errors. */ }
      return;
    }
    if (value && typeof value === "object") {
      // Console streaming uses Log; Log_s is the legacy Log Analytics envelope.
      // Unknown fields, timestamps, identities and metadata never reach output.
      if (Object.hasOwn(value, "Log")) { collect(value.Log, depth + 1); return; }
      if (Object.hasOwn(value, "Log_s")) { collect(value.Log_s, depth + 1); return; }
    }
    const event = safeAzureEvent(value);
    if (event) events.push(event);
  }
  try { collect(JSON.parse(text)); }
  catch {
    for (const line of text.split("\n")) {
      try { collect(JSON.parse(line)); } catch { /* Never echo parse errors or source text. */ }
    }
  }
  return events;
}

async function azureCommand(args) {
  const { stdout } = await execute("az", args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, AZURE_EXTENSION_USE_DYNAMIC_INSTALL: "no" } });
  return stdout;
}

/** Read-only snapshots of all currently active revisions/replicas; never pinned names. */
export async function retrieveAzureDiagnostics(command = azureCommand, { pause = wait } = {}) {
  let retrieved = false;
  const events = new Map();
  // Rediscover targets each time to accommodate replica/revision changes. Brief
  // retries cover console-stream visibility, not long-term Log Analytics ingestion.
  for (const delay of [0, 2000, 4000]) {
    if (delay) await pause(delay);
    try {
      const revisions = JSON.parse(await command(["containerapp", "revision", "list", ...target,
        "--query", "[?properties.active].name", "--output", "json", "--only-show-errors"]));
      if (!Array.isArray(revisions) || !revisions.length || revisions.length > 8) throw new Error();
      let replicasSeen = 0;
      for (const revision of revisions) {
        if (typeof revision !== "string" || !/^connectwise-mcp-pilot--[a-z0-9-]{1,80}$/.test(revision)) throw new Error();
        const replicas = JSON.parse(await command(["containerapp", "replica", "list", ...target,
          "--revision", revision, "--query", "[].{name:name,containers:properties.containers[].name}",
          "--output", "json", "--only-show-errors"]));
        if (!Array.isArray(replicas) || !replicas.length) throw new Error();
        for (const replica of replicas) {
          if (++replicasSeen > 32 || typeof replica.name !== "string" ||
              !/^[a-z0-9-]{1,200}$/.test(replica.name) || !Array.isArray(replica.containers) ||
              !replica.containers.length || replica.containers.length > 8) throw new Error();
          for (const container of replica.containers) {
            if (typeof container !== "string" || !/^[a-z0-9-]{1,80}$/.test(container)) throw new Error();
            const snapshot = await command(["containerapp", "logs", "show", ...target,
              "--revision", revision, "--replica", replica.name, "--container", container,
              "--type", "console", "--tail", "300", "--format", "json", "--only-show-errors"]);
            retrieved = true;
            for (const event of filterAzureLogs(snapshot)) events.set(JSON.stringify(event), event);
          }
        }
      }
      if (events.size) return { status: "retrieved", events: [...events.values()] };
    } catch {
      // Missing CLI, expired login, wrong subscription, RBAC, extensions and network
      // errors may include sensitive stderr; discard them all without disturbing MCP.
      // Keep any successful earlier snapshot instead of describing it as CLI failure.
      if (!retrieved) return { status: "unavailable", events: [] };
    }
  }
  return { status: retrieved ? "retrieved" : "unavailable", events: [...events.values()] };
}

export async function main({ args = process.argv.slice(2), run = runDiagnostic,
  openBrowser = openDefaultBrowser, azure = retrieveAzureDiagnostics,
  output = text => process.stdout.write(text + "\n"),
  progress = text => process.stderr.write(text + "\n") } = {}) {
  if (args.some(arg => !["--azure-logs", "--expect-read-tools"].includes(arg)) || new Set(args).size !== args.length) {
    output(JSON.stringify({ resourceTokenVerified: false, approvedIdMatched: false, failureStage: "arguments" }));
    return 1;
  }
  let facts;
  // Reuse the existing summary whitelist as well as its verification/handshake.
  const code = await safeDiagnosticMain(() => run({ freshLogin: true,
    // This operator workflow targets the pinned pilot, not stale service variables
    // in the shell. Preserve the TLS-disable rejection; never read CW credentials.
    env: { NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED }, openBrowser: async url => {
    progress("Opening browser for fresh Monotorr SAML authentication...");
    return openBrowser(url);
  } }), text => { facts = JSON.parse(text); });
  const matched = facts.resourceTokenVerified === true && facts.approvedIdMatchPaths.length > 0;
  if (facts.resourceTokenVerified && !matched) {
    output(JSON.stringify({ resourceTokenVerified: true, approvedIdMatched: false,
      nextAction: "Re-authenticate with the intended Monotorr SAML identity" }));
    return 2;
  }
  const summary = { resourceTokenVerified: facts.resourceTokenVerified, approvedIdMatched: matched,
    ...(matched ? facts : { failureStage: "oauth_or_token_validation" }) };
  const checkInventory = args.includes("--expect-read-tools");
  if (checkInventory) {
    summary.expectedReadToolSetMatched = matched && facts.mcpInitializeSucceeded === true &&
      facts.toolsListSucceeded === true && matchesReadToolInventory(facts.toolNames);
    if (code === 0 && !summary.expectedReadToolSetMatched) summary.failureStage = "tool_inventory";
  }
  if (matched && args.includes("--azure-logs")) {
    let logs;
    try { logs = await azure(); } catch { logs = { status: "unavailable", events: [] }; }
    // Apply the whitelist again even to injected/retrieved events.
    const emitted = new Set();
    if (Array.isArray(logs.events)) {
      for (const item of logs.events) {
        const event = safeAzureEvent(item);
        if (event) emitted.add(JSON.stringify(event));
      }
    }
    for (const event of emitted) progress(event);
    const retrieved = logs.status === "retrieved";
    progress(JSON.stringify({ azureDiagnosticsRetrieved: retrieved, structuredEventsFound: emitted.size > 0,
      ...(emitted.size ? { eventCount: emitted.size } : { reason: retrieved ? "no_matching_events" : "azure_cli_unavailable" }),
    }));
  }
  output(JSON.stringify(summary));
  return code === 0 && checkInventory && !summary.expectedReadToolSetMatched ? 4 : code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
