import { breadcrumbPreflight, releaseMigrationContext, contextEnv, pollReceipt, migrationAttestation, receiptConfiguration, storeEnv } from "./migration-breadcrumbs.mjs";
import { migrationPlan, readControlRequirements, verifyControlRequirements, migrationJobArgs } from "./migration-features.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configuration, az, execute, assertSubscription, immutableImage, featureOnlyDeployment } from "./common.mjs";
import { assessMcpImpact } from "./mcp-impact.mjs";
import { controlCondition, requireControlTraffic, readControlTraffic } from "./control-condition.mjs";
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
    if (action === "prepare" || action === "prepare-slice3") {
        const built = await imageAndSource(c, "existing");
        immutableImage(c, current.image);
        const previousTags = JSON.parse(await az(["acr", "manifest", "show-metadata", "--registry", c.registry, "--name", current.image.split("/").slice(1).join("/"), "--query", "tags", "-o", "json"]));
        const sourceTags = previousTags.filter(tag => /^[a-f0-9]{40}$/.test(tag));
        const previousSha = sourceTags.length === 1 ? sourceTags[0] : undefined;
        if (!previousSha)
            throw new Error("previous_source_unknown");
        const condition = action === "prepare-slice3" ? await controlCondition(previousSha, built.sha) : undefined;
        const schemaPlan = await migrationPlan(await readControlRequirements(az, c));
        if (condition?.kind === "control-only" && await readControlRequirements(az, c, current.revision) !== schemaPlan.selection) throw new Error("control_feature_expansion_requires_migration");
        if (condition) {
            requireControlTraffic(current.traffic,current.revision);
            const selected=JSON.parse(await az(["containerapp","revision","show",...target,"--revision",current.revision,"--query","{image:properties.template.containers[0].image,health:properties.healthState}","-o","json"]));
            if(selected.image!==current.image||selected.health!=="Healthy")throw new Error("control_baseline_unconfirmed");
            await smoke(`https://${current.fqdn}`,"control-api");
        }
        const migrationContext = condition?.kind === "control-only" ? undefined : releaseMigrationContext(built, schemaPlan);
        const receiptStore = migrationContext ? await receiptConfiguration() : undefined;
        if (migrationContext) await breadcrumbPreflight(az, c, receiptStore);
        await az(["containerapp", "ingress", "traffic", "set", ...target, "--revision-weight", `${current.revision}=100`, "-o", "none"]);
        if(condition)await readControlTraffic(az,target,current.revision);
        await mkdir(".delivery", { recursive: true });
        // Persist rollback evidence BEFORE changing the candidate or migration job.
        const manifest = { ...built, previousRevision: current.revision, previousImage: current.image, previousSha, portalArtifactSha: built.sha, schemaPlan, ...(condition ? {condition} : {}) };
        await writeFile(manifestPath, JSON.stringify(manifest) + "\n");
        let execution, migrationProof;
        if(condition?.kind!=="control-only") {
            await az(["containerapp", "job", "update", "-n", c.migrationJob, "-g", c.resourceGroup, "--image", built.image, "--command", "node", "--args", ...migrationJobArgs(schemaPlan), "--set-env-vars", contextEnv(migrationContext), storeEnv(receiptStore), "-o", "none"]);
            const job = JSON.parse(await az(["containerapp", "job", "show", "-n", c.migrationJob, "-g", c.resourceGroup, "--query", "properties.template.containers[].{image:image,command:command,args:args,context:env[?name=='CW_MIGRATION_CONTEXT'].value,store:env[?name=='CW_MIGRATION_RECEIPT_STORE'].value}", "-o", "json"]));
            if (!Array.isArray(job) || job.length !== 1 || job[0].image !== built.image || JSON.stringify(job[0].command) !== JSON.stringify(["node"]) || JSON.stringify(job[0].args) !== JSON.stringify(migrationJobArgs(schemaPlan))) throw new Error("migration_job_mismatch");
            if (JSON.stringify(job[0].context) !== JSON.stringify([contextEnv(migrationContext).split("=")[1]])) throw new Error("migration_job_context_mismatch");
            if (JSON.stringify(job[0].store) !== JSON.stringify([storeEnv(receiptStore).split("=")[1]])) throw new Error("migration_job_store_mismatch");
            execution = await az(["containerapp", "job", "start", "-n", c.migrationJob, "-g", c.resourceGroup, "--query", "name", "-o", "tsv"]);
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
            const executionContainers = JSON.parse(await az(["containerapp", "job", "execution", "show", "-n", c.migrationJob, "-g", c.resourceGroup, "--job-execution-name", execution, "--query", "properties.template.containers[].{image:image,command:command,args:args,context:env[?name=='CW_MIGRATION_CONTEXT'].value,store:env[?name=='CW_MIGRATION_RECEIPT_STORE'].value}", "-o", "json"]));
            if (JSON.stringify(executionContainers) !== JSON.stringify(job)) throw new Error("migration_execution_mismatch");
            // Detailed receipts have a separate 30-day lifetime; active provenance retains an attestation only.
            let evidence, observed = [];
            try {
                evidence = await pollReceipt(az, migrationContext, execution, schemaPlan, {store:receiptStore, observe: events => { observed = events; }});
                if (!migrated) throw new Error("migration_not_succeeded");
                migrationProof = migrationAttestation(evidence);
            } finally {
                await writeFile(".delivery/migration-breadcrumb.json", JSON.stringify({version:"migration-breadcrumb-v1", context:migrationContext, execution, azureExecutionSucceeded:migrated, ...(evidence ? {evidence} : {completion:"unproven", events:observed})}) + "\n");
            }

        }
        await verifyControlRequirements(az, c, schemaPlan);
        const suffix = `p0-${built.sha.slice(0, 12)}`;
        await az(["containerapp", "update", ...target, "--image", built.image, "--revision-suffix", suffix, ...(c.customerLoginClientId ? ["--set-env-vars", "CW_CONNECTION_SETUP_ENABLED=true", "CW_CUSTOMER_FEATURES_ENABLED=true", `CW_PORTAL_LOGIN_CLIENT_ID=${c.customerLoginClientId}`] : []), "-o", "none"]);
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
        await verifyControlRequirements(az, c, schemaPlan, revision);
        await az(["containerapp", "revision", "label", "add", ...target, "--revision", revision, "--label", "candidate", "--yes", "-o", "none"]);
        const domain = current.fqdn.split(".").slice(1).join(".");
        await smoke(`https://${c.controlApi}---candidate.${domain}`, "control-api");
        await smoke("https://api.monotorr.com", "mcp");
        await writeFile(manifestPath, JSON.stringify({ ...manifest, revision, candidateSmokePassed: true, execution, migrationProof }) + "\n");
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
        if ((await execute("git", ["status", "--porcelain"])).stdout.trim())
            throw new Error("dirty_release_source");
        const impact = await assessMcpImpact(manifest.previousSha, sha);
        if (impact.impact !== "unchanged")
            throw new Error("mcp_affecting_release_requires_separate_review_and_owner_dogfood");
    }
    if (action === "promote") {
        await verifyControlRequirements(az, c, manifest.schemaPlan);
        await verifyControlRequirements(az, c, manifest.schemaPlan, revision);
    }
    if (!selected.active)
        await az(["containerapp", "revision", "activate", ...target, "--revision", revision, "-o", "none"]);
    await az(["containerapp", "ingress", "traffic", "set", ...target, "--revision-weight", `${revision}=100`, "-o", "none"]);
    if(manifest.condition)await readControlTraffic(az,target,revision);
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
