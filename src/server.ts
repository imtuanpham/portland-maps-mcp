import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getConfig, loadEnvFiles } from "./config.ts";
import { createMcpServer, MCP_TOOL_NAMES } from "./registerTools.ts";

loadEnvFiles();
const cfg = getConfig();

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, mcp-session-id, Last-Event-ID, mcp-protocol-version, accept",
    "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
  };
}

function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) {
    h.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const listener = Bun.serve({
  hostname: cfg.host,
  port: cfg.port,
  /** MCP uses SSE; default 10s idle kills quiet streams. `0` = no idle timeout (Bun docs). */
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "portlandMapsMcp",
          portlandmapsKey: Boolean(cfg.portlandMapsApiKey),
          tools: [...MCP_TOOL_NAMES],
        },
        { headers: corsHeaders() },
      );
    }
    if (url.pathname === "/mcp") {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      const mcp = createMcpServer(cfg.portlandMapsApiKey);
      await mcp.connect(transport);
      const res = await transport.handleRequest(req);
      return withCors(res);
    }
    return new Response("Not found", { status: 404, headers: corsHeaders() });
  },
});

console.error(
  `[portlandMapsMcp] listening on http://${listener.hostname}:${listener.port}  (MCP: /mcp, health: /health)`,
);
