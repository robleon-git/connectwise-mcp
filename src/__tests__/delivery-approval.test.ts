import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const workflow = await readFile(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const delivery = workflow.split("  deliver:\n")[1];
const condition = delivery.match(/    if: >-\n([\s\S]*?)    needs: verify/)!;
const terms = condition[1].trim().split(/\s*&&\s*/).map(term => {
    const parsed = term.match(/^github\.([a-z_]+) == '([^']+)'$/);
    if (!parsed) throw new Error("unexpected_delivery_guard");
    return { field: parsed[1], value: parsed[2] };
});
const owner = { event_name: "workflow_dispatch", repository: "robleon-git/connectwise-mcp", ref: "refs/heads/phase1-hardening", actor: "robleon-git", triggering_actor: "robleon-git" };
const permitted = (context: Record<string, string>) => terms.every(term => context[term.field] === term.value);

describe("Codex-approved manual production operator boundary", () => {
    it("allows only the approved owner/repository/branch manual context", () => {
        expect(terms).toHaveLength(5);
        expect(permitted(owner)).toBe(true);
    });
    it.each([
        { event_name: "push" },
        { event_name: "pull_request" },
        { repository: "other/connectwise-mcp" },
        { ref: "refs/heads/main" },
        { ref: "refs/tags/phase1-hardening" },
        { actor: "other-operator" },
        { triggering_actor: "other-operator" },
    ])("denies production credentials for %j", override => {
        expect(permitted({ ...owner, ...override })).toBe(false);
    });
    it("retains manual-only trigger, environment and unprivileged verification", () => {
        const triggers = workflow.split("on:\n")[1].split("permissions:\n")[0];
        expect(triggers).toContain("  workflow_dispatch:");
        expect(triggers).not.toMatch(/^  (push|pull_request|schedule|workflow_run|repository_dispatch):/m);
        expect(delivery).toContain("    needs: verify");
        expect(delivery).toContain("    environment: connectwise-production");
        expect(delivery).toContain("      id-token: write");
        expect(workflow.split("  verify:\n")[1].split("  deliver:\n")[0]).not.toContain("id-token: write");
        expect(workflow).toContain("npm audit --omit=dev && npm audit");
    });
});
