import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PortlandMapsProvider } from "./providers/portlandMapsProvider.ts";
import type { PermitRecord } from "./providers/permits.ts";
import type { AddressCandidate } from "./providers/types.ts";
import { permitsTableHtml } from "./ui/cards.ts";

/** Tool names exposed by this server (for `/health`). */
export const MCP_TOOL_NAMES = [
  "ping",
  "resolve_address",
  "get_property_overview",
  "get_hazard_profile",
  "get_property_permits",
  "search_permits",
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

const MAX_PERMIT_JSON_ROWS = 60;

function permitRowsToJson(rows: PermitRecord[]) {
  return rows.map((r) => ({
    permitLabel: r.permitLabel,
    applicationNumber: r.applicationNumber ?? null,
    category: r.category ?? null,
    work: r.work ?? null,
    status: r.status ?? null,
    lastAction: r.lastAction ?? null,
    ivrNumber: r.ivrNumber ?? null,
    address: r.address ?? null,
    isCodeEnforcement: r.isCodeEnforcement,
  }));
}

const propertyPermitsArgs = z.object({
  display_address: z.string().optional().describe("Optional address label from resolve_address (for summary text)"),
  property_id: z.string().min(1).describe("Taxlot property_id from resolve_address (required)"),
});

const searchPermitsArgs = z
  .object({
    property_id: z.string().optional().describe("Taxlot property_id"),
    address: z.string().optional().describe("Address search string"),
    ivr_number: z.string().optional().describe("IVR / case number (digits)"),
    application_number: z.string().optional().describe("Permit application # e.g. 19-123456-000-00-FA"),
    date_from: z.string().optional().describe("mm/dd/yyyy (use with date_to)"),
    date_to: z.string().optional().describe("mm/dd/yyyy"),
    date_type: z.enum(["issued", "review", "final"]).optional(),
    search_type_id: z.number().optional().describe("PortlandMaps permit search_type_id filter"),
    count: z.number().min(1).max(100).optional().describe("Max rows (default 25, cap 100)"),
    page: z.number().optional(),
  })
  .refine(
    (d) =>
      Boolean(d.property_id?.trim()) ||
      Boolean(d.address?.trim()) ||
      Boolean(d.ivr_number?.trim()) ||
      Boolean(d.application_number?.trim()) ||
      d.search_type_id !== undefined ||
      (Boolean(d.date_from?.trim()) && Boolean(d.date_to?.trim())),
    {
      message:
        "Provide at least one of: property_id, address, ivr_number, application_number, search_type_id, or both date_from and date_to (mm/dd/yyyy).",
      path: ["address"],
    },
  );

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
          ? `One strong match. Use its property_id and coordinates with get_property_overview, get_hazard_profile, and get_property_permits.`
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

  server.registerTool(
    "get_property_permits",
    {
      title: "Property permits and cases",
      description:
        "Permits and related cases for a taxlot from PortlandMaps detail_type=permits. Includes building permits and code enforcement–style rows when present. Requires property_id from resolve_address.",
      inputSchema: propertyPermitsArgs,
    },
    async (args) => {
      if (!provider) {
        return {
          content: toolText("Missing PORTLANDMAPS_API_KEY in environment."),
          isError: true,
        };
      }
      const propertyId = args.property_id.trim();
      if (!propertyId) {
        return { content: toolText("property_id is required."), isError: true };
      }
      const { rows, summary, error } = await provider.getPropertyPermits(propertyId, args.display_address?.trim());
      const slice = rows.slice(0, MAX_PERMIT_JSON_ROWS);
      const jsonBody = JSON.stringify(
        {
          property_id: propertyId,
          row_count: rows.length,
          rows_json_truncated: rows.length > slice.length,
          rows: permitRowsToJson(slice),
        },
        null,
        2,
      );
      const truncNote =
        rows.length > slice.length
          ? `Structured JSON lists the first ${slice.length} of ${rows.length} rows.`
          : "";
      const html = rows.length ? permitsTableHtml(rows, `Permits / cases — ${args.display_address ?? propertyId}`) : "";
      const parts = [summary, truncNote, "```json\n" + jsonBody + "\n```", html];
      if (error) parts.push(`API detail: ${error.slice(0, 280)}`);
      return { content: toolText(...parts), ...(rows.length === 0 && error ? { isError: true } : {}) };
    },
  );

  server.registerTool(
    "search_permits",
    {
      title: "Search permits (citywide)",
      description:
        "Search PortlandMaps /api/permit/ with filters. Prefer get_property_permits when you already have a taxlot property_id. Supply at least one scope field (see schema). Dates use mm/dd/yyyy.",
      inputSchema: searchPermitsArgs,
    },
    async (args) => {
      if (!provider) {
        return {
          content: toolText("Missing PORTLANDMAPS_API_KEY in environment."),
          isError: true,
        };
      }
      const params = {
        property_id: args.property_id?.trim() || undefined,
        address: args.address?.trim() || undefined,
        ivr_number: args.ivr_number?.trim() || undefined,
        application_number: args.application_number?.trim() || undefined,
        date_from: args.date_from?.trim() || undefined,
        date_to: args.date_to?.trim() || undefined,
        date_type: args.date_type,
        search_type_id: args.search_type_id,
        count: args.count,
        page: args.page,
      };
      const { rows, summary, error } = await provider.searchPermits(params);
      const slice = rows.slice(0, MAX_PERMIT_JSON_ROWS);
      const jsonBody = JSON.stringify(
        {
          row_count: rows.length,
          rows_json_truncated: rows.length > slice.length,
          rows: permitRowsToJson(slice),
        },
        null,
        2,
      );
      const truncNote =
        rows.length > slice.length
          ? `Structured JSON lists the first ${slice.length} of ${rows.length} rows.`
          : "";
      const html = rows.length ? permitsTableHtml(rows, "Permit search results") : "";
      const parts = [summary, truncNote, "```json\n" + jsonBody + "\n```", html];
      if (error) parts.push(`API detail: ${error.slice(0, 280)}`);
      return { content: toolText(...parts), ...(rows.length === 0 && error ? { isError: true } : {}) };
    },
  );

  return server;
}
