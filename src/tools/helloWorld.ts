import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerHelloWorldTool(server: McpServer): void {
  server.registerTool(
    "helloWorld",
    {
      title: "Hello World",
      description: "Returns a short greeting (minimal MCP smoke test).",
      inputSchema: {
        name: z.string().optional().describe("Name to greet; defaults to World"),
      },
    },
    async ({ name }) => {
      const who = name?.trim() || "World";
      return {
        content: [{ type: "text" as const, text: `Hello, ${who}!` }],
      };
    },
  );
}
