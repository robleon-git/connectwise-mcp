// Read-only Azure/DNS/HTTP inspection; writes only a nonsecret local evidence file.
import { mkdir, writeFile } from "node:fs/promises";
import { resolveCname } from "node:dns/promises";
import { configuration, assertSubscription, az } from "./common.mjs";
import { smoke } from "./smoke.mjs";
try {
    const c = await configuration();
    await assertSubscription(c);
    const projection = "{revision:properties.latestReadyRevisionName,mode:properties.configuration.activeRevisionsMode,traffic:properties.configuration.ingress.traffic,image:properties.template.containers[0].image,explicitProbeCount:length(properties.template.containers[0].probes || `[]`)}";
    const raw = JSON.parse(await az(["containerapp", "show", "-n", "connectwise-mcp-pilot", "-g", c.sharedResourceGroup, "--query", projection, "-o", "json"]));
    if (!/^connectwise-mcp-pilot--[a-z0-9-]+$/.test(raw.revision) || !/^monotorrdevacr6689\.azurecr\.io\/connectwise-mcp@sha256:[a-f0-9]{64}$/.test(raw.image) || !["Single", "Multiple"].includes(raw.mode))
        throw new Error();
    const traffic = raw.traffic.map(t => { if (!Number.isInteger(t.weight) || t.weight < 0 || t.weight > 100 || (t.revisionName && !/^connectwise-mcp-pilot--[a-z0-9-]+$/.test(t.revisionName)))
        throw new Error(); return { weight: t.weight, ...(t.revisionName ? { revisionName: t.revisionName } : { latestRevision: t.latestRevision === true }) }; });
    const cname = await resolveCname("api.monotorr.com");
    if (cname.some(x => !/^[-a-z0-9.]+$/.test(x)))
        throw new Error();
    await smoke("https://api.monotorr.com", "mcp");
    await mkdir(".delivery", { recursive: true });
    await writeFile(".delivery/mcp-baseline.json", JSON.stringify({ observedAt: new Date().toISOString(), revision: raw.revision, mode: raw.mode, image: raw.image, traffic, explicitProbeCount: raw.explicitProbeCount, cname, publicSmokePassed: true }) + "\n");
    console.log(JSON.stringify({ baselineCaptured: true, publicSmokePassed: true }));
}
catch {
    console.error(JSON.stringify({ baselineCaptured: false, details: "redacted" }));
    process.exitCode = 1;
}
