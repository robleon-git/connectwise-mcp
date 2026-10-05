import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** SDK 1.32 preserves _meta but omits top-level securitySchemes from its built-in
 * tools/list serializer. Adapt that public handler at registration, preserving
 * schemas, UI metadata, callbacks and the exact existing tool inventory.
 */
export function installToolSecurityMetadata(server: McpServer, scope: string): void {
  const register = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => {
    if ((schema as unknown) !== ListToolsRequestSchema) { register(schema, handler); return; }
    register(schema, async (request, extra) => {
      const result = await handler(request, extra);
      const listing = result as { tools: Record<string, unknown>[] };
      const securitySchemes = [{ type: "oauth2", scopes: [scope] }];
      return { ...result, tools: listing.tools.map(tool => ({
        ...tool, securitySchemes,
        annotations: { ...(tool.annotations as object | undefined), readOnlyHint: true, destructiveHint: false },
        _meta: { ...(tool._meta as object | undefined), securitySchemes },
      })) };
    });
  };
}
