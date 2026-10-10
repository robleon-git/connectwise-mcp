import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuration, az, execute, assertSubscription, immutableImage, featureOnlyDeployment, needsDogfood } from "./common.mjs";
import { smoke } from "./smoke.mjs";
const manifestPath = ".delivery/control-release.json";
async function imageAndSource(c, mode) {
    if ((await execute("git", ["status", "--porcelain"])).stdout.trim())
        throw new Error("dirty_release_source");
    const sha = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(sha))
        throw new Error();
    if (mode === "build") {
        const repositoryExists=await az(["acr","repository","list","-n",c.registry,"--query", "contains(@, 'connectwise-control-api')", "-o", "tsv"]);
        if(repositoryExists==="true"){const tagExists=await az(["acr","repository","show-tags","-n",c.registry,"--repository","connectwise-control-api","--query",`contains(@, '${sha}')`,"-o","tsv"]);if(tagExists==="true") throw new Error("immutable_build_already_exists");}
        const tag = `${c.registry}.azurecr.io/connectwise-control-api:${sha}`;
        await execute("docker", ["build", "--platform", "linux/amd64", "-f", "Dockerfile.control-plane", "--build-arg", `COMMIT_SHA=${sha}`, "-t", tag, "."], { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
        await az(["acr", "login", "-n", c.registry]);
        await execute("docker", ["push", tag], { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
        const digest = await az(["acr", "manifest", "show-metadata", "--registry", c.registry, "--name", `connectwise-control-api:${sha}`, "--query", "digest", "-o", "tsv"]);
        const image = immutableImage(c, `${c.registry}.azurecr.io/connectwise-control-api@${digest}`);
        await mkdir(".delivery", { recursive: true });
        await writeFile(".delivery/built-image.json", JSON.stringify({ sha, image }) + "\n");
        return { sha, image };
    }
    const artifact = JSON.parse(await readFile(".delivery/built-image.json", "utf8"));
    if (artifact.sha !== sha)
        throw new Error("artifact_source_mismatch");
    immutableImage(c, artifact.image);
    return artifact;
}
export async function release(action) {
    const c = await configuration();
    featureOnlyDeployment("control-api");
    await assertSubscription(c);
    if (action === "build")
        return { built: true, ...await imageAndSource(c, "build") };
    const target = ["-n", c.controlApi, "-g", c.resourceGroup];
    const current = JSON.parse(await az(["containerapp", "show", ...target, "--query", "{mode:properties.configuration.activeRevisionsMode,revision:properties.latestReadyRevisionName,traffic:properties.configuration.ingress.traffic,fqdn:properties.configuration.ingress.fqdn,image:properties.template.containers[0].image}", "-o", "json"]));
    if (current.mode !== "Multiple")
        throw new Error("control_revision_mode_required");
    if (action === "prepare") {
        const built = await imageAndSource(c, "existing");
        immutableImage(c, current.image);
        const previousTags = JSON.parse(await az(["acr", "manifest", "show-metadata", "--registry", c.registry, "--name", current.image.split("/").slice(1).join("/"), "--query", "tags", "-o", "json"]));
        const previousSha = previousTags.find(tag => /^[a-f0-9]{40}$/.test(tag));
        if (!previousSha)
            throw new Error("previous_source_unknown");
        await az(["containerapp", "ingress", "traffic", "set", ...target, "--revision-weight", `${current.revision}=100`, "-o", "none"]);
        await mkdir(".delivery", { recursive: true });
        // Persist rollback evidence BEFORE changing the candidate or migration job.
        const manifest = { ...built, previousRevision: current.revision, previousImage: current.image, previousSha, portalArtifactSha: built.sha };
        await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
        await az(["containerapp", "job", "update", "-n", c.migrationJob, "-g", c.resourceGroup, "--image", built.image, "-o", "none"]);
        const execution = await az(["containerapp", "job", "start", "-n", c.migrationJob, "-g", c.resourceGroup, "--query", "name", "-o", "tsv"]);
        if (!/^[a-z0-9-]+$/.test(execution))
            throw new Error("invalid_execution");
        let migrated = false;
        for (let i = 0; i < 40; i++) {
            const status = await az(["containerapp", "job", "execution", "show", "-n", c.migrationJob, "-g", c.resourceGroup, "--job-execution-name", execution, "--query", "properties.status", "-o", "tsv"]);
            if (status === "Succeeded") {
                migrated = true;
                break;
            }
            if (status === "Failed")
                break;
            await new Promise(r => setTimeout(r, 3000));
        }
        if (!migrated)
            throw new Error("migration_not_succeeded");
        const suffix = `p0-${built.sha.slice(0, 12)}`;
        await az(["containerapp", "update", ...target, "--image", built.image, "--revision-suffix", suffix, "-o", "none"]);
        const revision = `${c.controlApi}--${suffix}`;
        let candidate;
        for (let i = 0; i < 30; i++) {
            candidate = JSON.parse(await az(["containerapp", "revision", "show", ...target, "--revision", revision, "--query", "{health:properties.healthState,image:properties.template.containers[0].image}", "-o", "json"]));
            if (candidate.image !== built.image)
                throw new Error("candidate_image_mismatch");
            if (candidate.health === "Healthy")
                break;
            await new Promise(r => setTimeout(r, 2000));
        }
        if (candidate?.health !== "Healthy")
            throw new Error("candidate_not_ready");
        await az(["containerapp", "revision", "label", "add", ...target, "--revision", revision, "--label", "candidate", "-o", "none"]);
        const domain = current.fqdn.split(".").slice(1).join(".");
        await smoke(`https://${c.controlApi}---candidate.${domain}`, "control-api");
        await smoke("https://api.monotorr.com", "mcp");
        await writeFile(manifestPath, JSON.stringify({ ...manifest, revision, candidateSmokePassed: true, execution }) + "\n");
        return { prepared: true, revision, image: built.image };
    }
    if (!["promote", "rollback"].includes(action))
        throw new Error("invalid_release_action");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    immutableImage(c, manifest.image);
    immutableImage(c, manifest.previousImage);
    const revision = action === "promote" ? manifest.revision : manifest.previousRevision;
    if (!new RegExp(`^${c.controlApi}--[a-z0-9-]+$`).test(revision || "") || (action === "promote" && !manifest.candidateSmokePassed))
        throw new Error("invalid_release_manifest");
    const selected = JSON.parse(await az(["containerapp", "revision", "show", ...target, "--revision", revision, "--query", "{image:properties.template.containers[0].image,health:properties.healthState,active:properties.active}", "-o", "json"]));
    if (typeof selected.active !== "boolean")
        throw new Error("revision_active_state_unknown");
    if (selected.image !== (action === "promote" ? manifest.image : manifest.previousImage))
        throw new Error("revision_image_mismatch");
    if (action === "promote") {
        if (selected.health !== "Healthy") throw new Error("candidate_not_ready");
        const sha = (await execute("git", ["rev-parse", "HEAD"])).stdout.trim();
        if (sha !== manifest.sha)
            throw new Error("artifact_source_mismatch");
        if (!/^[a-f0-9]{40}$/.test(manifest.previousSha || ""))
            throw new Error("previous_source_unknown");
        await execute("git", ["merge-base", "--is-ancestor", manifest.previousSha, sha]);
        const changed = (await execute("git", ["diff", "--name-only", manifest.previousSha, sha])).stdout.trim().split("\n");
        if (needsDogfood(changed))
            throw new Error("mcp_affecting_release_requires_separate_review_and_owner_dogfood");
    }
    if (!selected.active)
        await az(["containerapp", "revision", "activate", ...target, "--revision", revision, "-o", "none"]);
    await az(["containerapp", "ingress", "traffic", "set", ...target, "--revision-weight", `${revision}=100`, "-o", "none"]);
    await smoke(`https://${current.fqdn}`, "control-api");
    await smoke("https://api.monotorr.com", "mcp");
    return { action, revision };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (process.argv.length !== 3)
            throw new Error();
        console.log(JSON.stringify(await release(process.argv[2])));
    }
    catch {
        console.error(JSON.stringify({ releaseSucceeded: false, details: "redacted" }));
        process.exitCode = 1;
    }
}
