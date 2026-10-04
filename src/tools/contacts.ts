import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";
import { buildContactSearchQuery } from "./contact-search.js";

export function registerContactTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_search_contacts",
    "Search contacts in ConnectWise Manage. Parent fields go in conditions with double-quoted strings (e.g. firstName = \"John\" or company/id = 5). There is no contact field named name — use firstName and lastName (a bare name = \"...\" is rewritten to those). Contact type is a child collection: do not put types or types/name in conditions (Manage returns 400 ApiFindCondition). Filter type with typeName, typeId, or childConditions such as types/name = \"Primary\". Single quotes are accepted and sent as double quotes.",
    {
      conditions: z
        .string()
        .optional()
        .describe("Parent-field conditions. Strings use double quotes. types/name is not valid here — use typeName or childConditions."),
      childConditions: z
        .string()
        .optional()
        .describe("Child-collection conditions, e.g. types/name = \"Primary\" or types/id = 2. This is the Manage query param that filters contact type without listing every contact."),
      typeName: z
        .string()
        .optional()
        .describe("Contact type name. Sent as childConditions types/name=\"...\". Prefer this over conditions types/name."),
      typeId: z
        .number()
        .optional()
        .describe("Contact type id. Sent as childConditions types/id=<id>."),
      page: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Results per page (default: 25, max: 1000)"),
      orderBy: z.string().optional().describe("Field to order by"),
    },
    async ({ conditions, childConditions, typeName, typeId, page, pageSize, orderBy }) => {
      const query = buildContactSearchQuery({ conditions, childConditions, typeName, typeId });
      const result = await client.get("/company/contacts", {
        conditions: query.conditions,
        childConditions: query.childConditions,
        page: page ?? 1,
        pageSize: pageSize ?? 25,
        orderBy,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "cw_get_contact",
    "Get a specific contact by ID.",
    {
      id: z.number().describe("Contact ID"),
    },
    async ({ id }) => {
      const result = await client.get(`/company/contacts/${id}`);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );
}
