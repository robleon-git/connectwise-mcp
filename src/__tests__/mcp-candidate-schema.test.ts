import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Ajv, type ValidateFunction } from "ajv";
// @ts-expect-error Delivery script has no declarations.
import { candidateResource, MCP_CANDIDATE } from "../../scripts/deploy/mcp-release.mjs";
const directory = new URL("./fixtures/azure-containerapps-2024-03-01/", import.meta.url);
const c = { subscriptionId: "08a97e42-1e1f-4f33-95dc-36af13337091", sharedResourceGroup: "monotorr-dev-eastus-rg", registry: "monotorrdevacr6689", databaseServer: "monotorr-cw-db-01", mcpResource: "https://api.monotorr.com/mcp" };
const image = `${c.registry}.azurecr.io/connectwise-mcp@sha256:${"a".repeat(64)}`;
// Azure publishes draft-04 schemas. Adapt identifiers to the installed AJV dialect only;
// all validation rules, enum values and reference targets remain unchanged.
function adapt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(adapt);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result = Object.fromEntries(Object.entries(object).filter(([key]) => key !== "$schema" && key !== "id").map(([key, child]) => [key, adapt(child)]));
    if (object.id) result.$id = object.id;
    return result;
  }
  return value;
}
let validate: ValidateFunction;
beforeAll(async () => {
  const root = JSON.parse(await readFile(new URL("containerapps.json", directory), "utf8"));
  const common = JSON.parse(await readFile(new URL("common-definitions.json", directory), "utf8"));
  const ajv = new Ajv({ strict: false, meta: false, validateSchema: false, allErrors: true, logger: false,
    loadSchema: async (uri: string) => {
      if (uri !== "https://schema.management.azure.com/schemas/common/definitions.json") throw new Error("unexpected_schema_reference");
      return adapt(common) as object;
    } });
  ajv.addSchema(adapt(root) as object, "candidate-schema");
  validate = await ajv.compileAsync({ $ref: "candidate-schema#/resourceDefinitions/containerApps" });
});
function resource() {
  // ARM name/type/API are supplied by the REST URL; add them for full resource-schema validation.
  return { name: MCP_CANDIDATE, type: "Microsoft.App/containerApps", apiVersion: "2024-03-01", ...candidateResource(c, image, "66.229.202.156/32") };
}
describe("pinned Azure Container Apps candidate schema", () => {
  it("pins official offline schema files by content hash and API version", async () => {
    const provenance = JSON.parse(await readFile(new URL("provenance.json", directory), "utf8"));
    expect(provenance.apiVersion).toBe("2024-03-01");
    expect(provenance.resourceType).toBe("Microsoft.App/containerApps");
    expect(provenance.sources).toHaveLength(2);
    for (const source of provenance.sources) {
      const bytes = await readFile(new URL(source.file, directory));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
    }
  });
  it("validates the complete generated payload against the pinned schema", () => {
    expect(validate(resource()), JSON.stringify(validate.errors)).toBe(true);
    expect(resource().identity.type).toBe("SystemAssigned,UserAssigned");
  });
  it("rejects the historical spaced identity enum", () => {
    const value = resource(); value.identity.type = "SystemAssigned, UserAssigned";
    expect(validate(value)).toBe(false);
    expect(validate.errors?.some(error => error.instancePath === "/identity/type" && error.keyword === "enum")).toBe(true);
  });
  it("preserves exact isolation, identity, network, sizing and credential constraints", () => {
    const value = resource();
    const shared = `/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}/providers`;
    const pull = `${shared}/Microsoft.ManagedIdentity/userAssignedIdentities/connectwise-mcp-pull-id`;
    expect(value.properties.managedEnvironmentId).toBe(`${shared}/Microsoft.App/managedEnvironments/monotorr-prod-aca-env`);
    expect(value.identity.userAssignedIdentities).toEqual({ [pull]: {} });
    expect(value.properties.configuration.registries).toEqual([{ server: `${c.registry}.azurecr.io`, identity: pull }]);
    expect(value.properties.configuration.activeRevisionsMode).toBe("Single");
    expect(value.properties.configuration.ingress).toEqual({ external: true, allowInsecure: false, targetPort: 8080, transport: "auto", ipSecurityRestrictions: [{ name: "operator-only", action: "Allow", ipAddressRange: "66.229.202.156/32" }], traffic: [{ latestRevision: true, weight: 100 }] });
    expect(value.properties.template.scale).toEqual({ minReplicas: 1, maxReplicas: 1 });
    expect(value.properties.template.containers).toHaveLength(1);
    expect(value.properties.template.containers[0].resources).toEqual({ cpu: 0.5, memory: "1Gi" });
    expect(value.properties.template.containers[0].image).toBe(image);
    expect(JSON.stringify(value)).not.toMatch(/CW_MANAGE_|MCP_APPROVED_USER|customDomains|secretRef/);
    expect(() => candidateResource(c, image.replace("@sha256:", ":"), "66.229.202.156/32")).toThrow("invalid_mcp_image");
    expect(() => candidateResource(c, image, "66.229.202.156/24")).toThrow("operator_public_ipv4_required");
  });
  it("defines only temporary environment join, with no data-plane or administration rights", async () => {
    const role = JSON.parse(await readFile(new URL("../../deployment/azure/mcp-environment-join-role.json", import.meta.url), "utf8"));
    expect(role.Actions).toEqual(["Microsoft.App/managedEnvironments/join/action"]);
    expect(role.NotActions).toEqual([]); expect(role.DataActions).toEqual([]); expect(role.NotDataActions).toEqual([]);
    expect(role.AssignableScopes).toEqual([`/subscriptions/${c.subscriptionId}/resourceGroups/${c.sharedResourceGroup}`]);
  });
});
