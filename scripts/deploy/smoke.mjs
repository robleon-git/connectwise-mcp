import { pathToFileURL } from "node:url";
export async function smoke(origin, kind, fetcher = fetch) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
        throw new Error("invalid_smoke_target");
    if (kind === "mcp" && url.origin !== "https://api.monotorr.com")
        throw new Error("invalid_smoke_target");
    if (kind === "control-api" && !/^connectwise-control-api(?:---[a-z0-9-]+)?\.[a-z0-9-]+\.eastus\.azurecontainerapps\.io$/.test(url.hostname))
        throw new Error("invalid_smoke_target");
    if (kind === "portal" && url.origin !== "https://portal.monotorr.com" && !/^[a-z0-9-]+\.[a-z0-9-]+\.azurestaticapps\.net$/.test(url.hostname))
        throw new Error("invalid_smoke_target");
    if (!["mcp", "control-api", "portal"].includes(kind))
        throw new Error("invalid_smoke_target");
    const check = async (path, expected, options = {}) => {
        const r = await fetcher(new URL(path, url), { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
        if (r.status !== expected)
            throw new Error("smoke_failed");
        return r;
    };
    if (kind === "mcp") {
        await check("/health", 200);
        const metadata = await (await check("/.well-known/oauth-protected-resource/mcp", 200)).json();
        if (metadata.resource !== "https://api.monotorr.com/mcp" || !Array.isArray(metadata.authorization_servers) || metadata.authorization_servers.length !== 1 || metadata.authorization_servers[0] !== "https://api.descope.com/v1/apps/agentic/P3KF3ouEKxhaIJBilPItOXL8i76g/RS3KF4WZS6MDxjAyDFqsBTcDQC7au" || !metadata.scopes_supported?.includes("connectwise.read"))
            throw new Error("smoke_failed");
        const denied = await check("/mcp", 401, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!denied.headers.get("WWW-Authenticate")?.includes("resource_metadata="))
            throw new Error("smoke_failed");
    }
    else if (kind === "control-api") {
        await check("/health", 200);
        await check("/ready", 200);
        for (const path of ["/api/account", "/api/signup", "/api/billing", "/api/connectwise", "/admin", "/mcp"])
            await check(path, 404, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    }
    else {
        const html = await (await check("/", 200)).text();
        if (!html.includes('id="root"') || !html.includes("/assets/"))
            throw new Error("smoke_failed");
        await check("/api/account", 404);
        await check("/.auth/login/aad", 404);
        await check("/.auth/login/github", 404);
    }
    return { smokePassed: true, component: kind };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 4)
            throw new Error();
        console.log(JSON.stringify(await smoke(process.argv[3], process.argv[2])));
    }
    catch {
        console.error(JSON.stringify({ smokePassed: false }));
        process.exitCode = 1;
    }
}
