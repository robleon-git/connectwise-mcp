import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";

// RFC 6902 requires a "value" member on add/replace but forbids relying on it
// for remove. A flat z.object with an optional value let a caller omit it on
// add/replace: applyPatchLocally would silently drop the field (undefined
// isn't serialized), producing a preview that looks fine while the live
// PATCH request goes out missing a member Manage requires. The discriminated
// union makes that combination unrepresentable instead of just undocumented.
//
// z.unknown() alone accepts `undefined` even when not marked .optional() —
// Zod treats an absent key the same as a present key valued `undefined` for
// an unknown/any field, so plain `value: z.unknown()` would NOT actually
// reject a missing value (confirmed by hand: it let `{ op: "replace", path:
// "quantity" }` straight through to the live fetch call, which then crashed
// on a mocked-undefined response instead of failing schema validation). The
// refine makes "present and not undefined" an explicit condition.
const requiredValue = z.unknown().refine((v) => v !== undefined, {
  message: "value is required for add/replace operations (RFC 6902)",
});

const _additionPatchOperation = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    path: z.string().describe("Field path (e.g. 'quantity', 'billCustomer', 'cancelledDate')"),
    value: requiredValue.describe("New value"),
  }),
  z.object({
    op: z.literal("replace"),
    path: z.string().describe("Field path (e.g. 'quantity', 'billCustomer', 'cancelledDate')"),
    value: requiredValue.describe("New value"),
  }),
  z.object({
    op: z.literal("remove"),
    path: z.string().describe("Field path (e.g. 'quantity', 'billCustomer', 'cancelledDate')"),
    value: z.unknown().optional().describe("Unused for remove"),
  }),
]);

type AdditionPatchOperation = z.infer<typeof _additionPatchOperation>;

/**
 * Applies flat-field JSON Patch operations to a record in memory, matching
 * the same simple-path convention (top-level field names, not nested JSON
 * Pointers) that cw_update_time_entry documents. Used for cw_update_agreement_addition's
 * dryRun mode so a preview never has to round-trip through Manage.
 */
export function applyPatchLocally(
  record: Record<string, unknown>,
  operations: AdditionPatchOperation[],
): Record<string, unknown> {
  const patched = { ...record };
  for (const { op, path, value } of operations) {
    const field = path.replace(/^\//, "");
    if (op === "remove") {
      delete patched[field];
    } else {
      patched[field] = value;
    }
  }
  return patched;
}

export function registerAgreementTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_agreements",
    "Search finance agreements (recurring revenue contracts) in ConnectWise Manage. Use 'conditions' for CW query syntax (e.g. \"cancelledFlag = false\", \"company/name = 'Acme'\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
    },
    async ({ conditions, page, pageSize, orderBy }) => {
      const result = await client.get("/finance/agreements", {
        conditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
        orderBy,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_get_agreement",
    "Get a specific finance agreement by ID.",
    {
      id: z.number().describe("Agreement ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/finance/agreements/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_get_agreement_additions",
    "Get additions (line items) for a specific agreement.",
    {
      agreementId: z.number().describe("Agreement ID"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
    },
    async ({ agreementId, page, pageSize }) => {
      const result = await client.get(`/finance/agreements/${agreementId}/additions`, {
        page: page ?? 1,
        pageSize: pageSize ?? 25,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_search_invoices",
    "Search invoices in ConnectWise Manage.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"company/name = 'Acme'\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by (e.g. 'id desc')"),
    },
    async ({ conditions, page, pageSize, orderBy }) => {
      const result = await client.get("/finance/invoices", {
        conditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
        orderBy,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_get_invoice",
    "Get a specific invoice by ID.",
    {
      id: z.number().describe("Invoice ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/finance/invoices/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
}
