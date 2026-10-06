import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CwManageClient } from "../api-client.js";
import { ApiRequestError } from "../diagnostics.js";

export function registerHealthTools(server: McpServer, client: CwManageClient) {
  server.tool(
    "cw_test_connection",
    "Test the connection to ConnectWise Manage with a GET-only system info check. Returns sanitized connectivity status.",
    {},
    async () => {
      try {
        await client.get("/system/info");
        return { content: [{ type: "text", text: JSON.stringify({ connected: true }) }], isError: false };
      } catch (error) {
        const status = error instanceof ApiRequestError && Number.isInteger(error.status) &&
          error.status! >= 100 && error.status! <= 599 ? error.status : undefined;
        return { content: [{ type: "text", text: JSON.stringify({ connected: false,
          error: status === 401 || status === 403 ? "authentication_failed" : "connection_failed",
          ...(status ? { httpStatus: status } : {}),
        }) }], isError: true };
      }
    },
  );
}
