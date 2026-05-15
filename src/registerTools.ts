import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PortlandMapsProvider } from "./providers/portlandMapsProvider.ts";
import type { AddressCandidate } from "./providers/types.ts";

/** Tool names exposed by this server (for `/health`). */
export const MCP_TOOL_NAMES = [
  "ping",
  "resolve_address",
  "get_property_overview",
  "get_hazard_profile",
] as const;

function toolText(...parts: string[]): { type: "text"; text: string }[] {
  return parts.filter(Boolean).map((text) => ({ type: "text" as const, text }));
}

function overviewSummary(o: import("./providers/types.ts").PropertyOverview): string {
  const bits: string[] = [];
  bits.push(`${o.address} (${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}).`);
  if (o.neighborhood) bits.push(`Neighborhood: ${o.neighborhood}.`);
  if (o.councilDistrict) bits.push(`Council: ${o.councilDistrict}.`);
  if (o.zoning) bits.push(`Zoning: ${o.zoning}.`);
  if (o.yearBuilt) bits.push(`Built ${o.yearBuilt}.`);
  if (o.squareFeet) bits.push(`~${o.squareFeet} sq ft.`);
  const hz = o.hazardChips.map((h) => `${h.label}:${h.level}`).join(", ");
  if (hz) bits.push(`Hazard summary: ${hz}.`);
  return bits.join(" ");
}

const hazardOrder = [
  "hazard-liquefaction",
  "hazard-earthquake-cascadia",
  "hazard-landslide",
  "hazard-flood",
  "hazard-steep-slope",
  "hazard-wild-lands-fire",
] as const;

const hazardTitles: Record<string, string> = {
  "hazard-liquefaction": "Liquefaction",
  "hazard-earthquake-cascadia": "Cascadia shaking",
  "hazard-landslide": "Landslide",
  "hazard-flood": "Flood",
  "hazard-steep-slope": "Steep slope",
  "hazard-wild-lands-fire": "Wildland fire",
};

function hazardSummary(p: import("./providers/types.ts").HazardProfile): string {
  return hazardOrder
    .map((k) => {
      const h = p.hazards[k];
      if (!h) return "";
      return `${hazardTitles[k] ?? k}: ${h.level} — ${h.label}`;
    })
    .filter(Boolean)
    .join("\n");
}

const locationArgs = z.object({
  display_address: z.string().describe("Full address label from resolve_address"),
  property_id: z.string().optional().describe("Taxlot property_id when known"),
  lat: z.number().optional(),
  lng: z.number().optional(),
  neighborhood: z.string().optional(),
  x_web_mercator: z.number().optional(),
  y_web_mercator: z.number().optional(),
});

function toCandidate(args: z.infer<typeof locationArgs>): AddressCandidate {
  const lat = args.lat ?? 0;
  const lng = args.lng ?? 0;
  return {
    displayAddress: args.display_address,
    propertyId: args.property_id,
    lat,
    lng,
    neighborhood: args.neighborhood,
    xWebMercator: args.x_web_mercator,
    yWebMercator: args.y_web_mercator,
    confidence: 1,
  };
}

export function createMcpServer(apiKey: string | undefined): McpServer {
  const server = new McpServer({
    name: "portlandMapsMcp",
    version: "0.1.0",
  });

  const provider = apiKey ? new PortlandMapsProvider(apiKey) : null;

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Health check — confirms the MCP server is running and PortlandMaps API key is loaded.",
    },
    async () => {
      const mode = provider ? "portlandmaps (key present)" : "degraded (missing PORTLANDMAPS_API_KEY)";
      return {
        content: toolText(`pong — ${mode}`),
      };
    },
  );

  server.registerTool(
    "resolve_address",
    {
      title: "Resolve Portland address",
      description:
        "Search PortlandMaps for address, intersection, or landmark matches. Returns candidates with property_id and coordinates for follow-up tools.",
      inputSchema: {
        query: z.string().describe("Address, intersection, or landmark text"),
      },
    },
    async ({ query }) => {
      if (!provider) {
        return {
          content: toolText(
            "PortlandMaps API key missing. Set PORTLANDMAPS_API_KEY in .env.local (see .env.example).",
          ),
          isError: true,
        };
      }
      const candidates = await provider.resolveAddress(query);
      if (candidates.length === 0) {
        return {
          content: toolText(
            `No matches for "${query}". Try a fuller street address inside Portland city limits.`,
          ),
        };
      }
      const summary =
        candidates.length === 1
          ? `One strong match. Use its property_id and coordinates with get_property_overview / get_hazard_profile.`
          : `${candidates.length} matches — choose the best property_id + address pair for follow-up tools.`;
      const structured = JSON.stringify(candidates, null, 2);
      return {
        content: toolText(summary, "```json\n" + structured + "\n```"),
      };
    },
  );

  server.registerTool(
    "get_property_overview",
    {
      title: "Property overview",
      description:
        "Assessor, zoning, leaf day, nearby school/park, and hazard summary chips for a matched Portland location.",
      inputSchema: locationArgs,
    },
    async (args) => {
      if (!provider) {
        return {
          content: toolText("Missing PORTLANDMAPS_API_KEY in environment."),
          isError: true,
        };
      }
      const c = toCandidate(args);
      if (args.lat === undefined || args.lng === undefined) {
        return {
          content: toolText(
            "lat and lng are required (copy from resolve_address JSON). property_id unlocks assessor + parcel hazards.",
          ),
          isError: true,
        };
      }
      const { overview } = await provider.getPropertyOverview(c);
      const text = overviewSummary(overview);
      return {
        content: toolText(text),
      };
    },
  );

  server.registerTool(
    "get_hazard_profile",
    {
      title: "Hazard profile",
      description:
        "Parcel-linked natural hazard detail from PortlandMaps (liquefaction, Cascadia, landslide, flood, slope, wildfire).",
      inputSchema: locationArgs,
    },
    async (args) => {
      if (!provider) {
        return {
          content: toolText("Missing PORTLANDMAPS_API_KEY in environment."),
          isError: true,
        };
      }
      if (args.lat === undefined || args.lng === undefined) {
        return {
          content: toolText("lat and lng are required."),
          isError: true,
        };
      }
      const c = toCandidate(args);
      const profile = await provider.getHazardProfile(c);
      const text = hazardSummary(profile);
      return {
        content: toolText(text || "No hazard rows returned."),
      };
    },
  );

  return server;
}
