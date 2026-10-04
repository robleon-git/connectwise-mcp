import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";

/**
 * Product Catalog tools (ConnectWise Procurement API).
 *
 * Covers the Product Catalog itself (/procurement/catalog) plus the lookup
 * entities typically needed when creating or filtering catalog items:
 * categories, subcategories, and manufacturers.
 */
export function registerCatalogTools(server: McpServer, client: CwManageClient) {
  // -------------------------------------------------------------------------
  // Catalog items
  // -------------------------------------------------------------------------

  server.tool(
    "cw_search_catalog_items",
    "Search the ConnectWise product catalog. Use 'conditions' for CW query syntax (e.g. \"identifier like '%SKU-%'\" or \"manufacturer/id=5\").",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by (e.g. 'identifier asc')"),
    },
    async ({ conditions, page, pageSize, orderBy }) => {
      const result = await client.get("/procurement/catalog", {
        conditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
        orderBy,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_get_catalog_item",
    "Get a specific catalog item by ID.",
    {
      id: z.number().describe("Catalog item ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/procurement/catalog/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  // -------------------------------------------------------------------------
  // Supporting lookup entities
  // -------------------------------------------------------------------------

  server.tool(
    "cw_list_catalog_categories",
    "List product categories from the ConnectWise catalog.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25)"),
    },
    async ({ conditions, page, pageSize }) => {
      const result = await client.get("/procurement/categories", {
        conditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_list_catalog_subcategories",
    "List product subcategories from the ConnectWise catalog.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string (e.g. \"category/id=3\")"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25)"),
    },
    async ({ conditions, page, pageSize }) => {
      const result = await client.get("/procurement/subCategories", {
        conditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_list_manufacturers",
    "List manufacturers referenced by catalog items.",
    {
      conditions: z.string().optional().describe("ConnectWise conditions query string"),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25)"),
    },
    async ({ conditions, page, pageSize }) => {
      const result = await client.get("/procurement/manufacturers", {
        conditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
}
