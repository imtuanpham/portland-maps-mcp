/**
 * Chains MCP tools for a concrete Portland address:
 * resolve_address("111 SW 5th Ave") → get_property_overview → get_hazard_profile → get_property_permits (when property_id).
 *
 * Uses InMemoryTransport + MCP Client against createMcpServer (real tool handlers + Zod).
 *
 * Requires PORTLANDMAPS_API_KEY (via .env / .env.local). Run:
 *   bun test src/e2e/addressDetailsChain.e2e.test.ts
 *
 * Optional: E2E_RESOLVE_ADDRESS_QUERY — override address text passed to resolve_address.
 *
 * Each tool’s MCP `CallToolResult` is snapshotted (see `__snapshots__/addressDetailsChain.e2e.test.ts.snap`).
 * Refresh after API output changes: `bun test src/e2e/addressDetailsChain.e2e.test.ts --update-snapshots`
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getConfig, loadEnvFiles } from "../config.ts";
import { createMcpServer } from "../registerTools.ts";
import type { AddressCandidate } from "../providers/types.ts";

loadEnvFiles();

const DEFAULT_RESOLVE_QUERY = "111 SW 5th Ave";

/** Stable shape for snapshot / inspection: full `content` blocks plus flattened text. */
function mcpToolResultSnapshot(result: unknown): {
  isError?: unknown;
  content: unknown;
  joinedText: string;
} {
  const joinedText = joinToolText(result);
  if (!result || typeof result !== "object") {
    return { content: undefined, joinedText };
  }
  const r = result as { isError?: unknown; content?: unknown };
  return {
    isError: r.isError,
    content: r.content,
    joinedText,
  };
}

function joinToolText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) return "";
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as { type?: string; text?: string }[]) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function parseCandidatesFromResolveTool(text: string): AddressCandidate[] {
  const fence = text.match(/```json\s*([\s\S]*?)\s*```/);
  const jsonBody = fence?.[1];
  if (jsonBody === undefined) throw new Error("resolve_address: expected ```json ... ``` block in tool text");
  const raw = JSON.parse(jsonBody.trim()) as unknown;
  if (!Array.isArray(raw)) throw new Error("resolve_address: JSON fence must be an array");
  const out: AddressCandidate[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const displayAddress =
      typeof o.displayAddress === "string"
        ? o.displayAddress
        : typeof o.display_address === "string"
          ? o.display_address
          : undefined;
    const lat = typeof o.lat === "number" ? o.lat : undefined;
    const lng = typeof o.lng === "number" ? o.lng : undefined;
    if (!displayAddress || lat === undefined || lng === undefined) continue;
    const propertyId =
      typeof o.propertyId === "string"
        ? o.propertyId
        : typeof o.property_id === "string"
          ? o.property_id
          : undefined;
    const neighborhood =
      typeof o.neighborhood === "string"
        ? o.neighborhood
        : typeof o.Neighborhood === "string"
          ? o.Neighborhood
          : undefined;
    const xWebMercator =
      typeof o.xWebMercator === "number"
        ? o.xWebMercator
        : typeof o.x_web_mercator === "number"
          ? o.x_web_mercator
          : undefined;
    const yWebMercator =
      typeof o.yWebMercator === "number"
        ? o.yWebMercator
        : typeof o.y_web_mercator === "number"
          ? o.y_web_mercator
          : undefined;
    const confidence = typeof o.confidence === "number" ? o.confidence : 0.75;
    out.push({
      displayAddress,
      propertyId,
      lat,
      lng,
      neighborhood,
      xWebMercator,
      yWebMercator,
      confidence,
    });
  }
  return out;
}

function pickCandidate(candidates: AddressCandidate[], hint: RegExp): AddressCandidate {
  const scored = candidates.map((c, i) => {
    let score = 0;
    if (hint.test(c.displayAddress)) score += 100;
    if (c.propertyId) score += 50;
    score -= i * 0.1;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.c;
}

function candidateToToolLocationArgs(c: AddressCandidate): Record<string, string | number> {
  const args: Record<string, string | number> = {
    display_address: c.displayAddress,
    lat: c.lat,
    lng: c.lng,
  };
  if (c.propertyId !== undefined) args.property_id = c.propertyId;
  if (c.neighborhood !== undefined) args.neighborhood = c.neighborhood;
  if (c.xWebMercator !== undefined) args.x_web_mercator = c.xWebMercator;
  if (c.yWebMercator !== undefined) args.y_web_mercator = c.yWebMercator;
  return args;
}

describe("MCP tool chain: resolve → overview → hazards → permits", () => {
  const cfg = getConfig();
  const hasKey = Boolean(cfg.portlandMapsApiKey);

  test.skipIf(!hasKey)(
    "chains tools over in-memory MCP transport",
    async () => {
    const apiKey = cfg.portlandMapsApiKey!;
    const resolveQuery = (process.env.E2E_RESOLVE_ADDRESS_QUERY ?? DEFAULT_RESOLVE_QUERY).trim();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = createMcpServer(apiKey);
    const client = new Client({ name: "portland-maps-e2e", version: "0.0.0" }, { capabilities: {} });

    await mcp.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const resolveRes = await client.callTool({
        name: "resolve_address",
        arguments: { query: resolveQuery },
      });
      expect(mcpToolResultSnapshot(resolveRes)).toMatchSnapshot("resolve_address");
      expect(resolveRes.isError).not.toBe(true);

      const resolveText = joinToolText(resolveRes);
      expect(resolveText).not.toMatch(/No matches for/);

      const candidates = parseCandidatesFromResolveTool(resolveText);
      expect(candidates.length).toBeGreaterThan(0);

      const hint = /111\s+sw\s+5th|5th\s+ave.*111|111.*5th/i;
      const chosen = pickCandidate(candidates, hint);
      expect(Number.isFinite(chosen.lat)).toBe(true);
      expect(Number.isFinite(chosen.lng)).toBe(true);

      const locationArgs = candidateToToolLocationArgs(chosen);

      const overviewRes = await client.callTool({
        name: "get_property_overview",
        arguments: locationArgs,
      });
      expect(mcpToolResultSnapshot(overviewRes)).toMatchSnapshot("get_property_overview");
      expect(overviewRes.isError).not.toBe(true);
      const overviewText = joinToolText(overviewRes);
      expect(overviewText.length).toBeGreaterThan(20);
      expect(overviewText).toMatch(/\(-?\d+\.\d+,\s*-?\d+\.\d+\)/);

      const hazardRes = await client.callTool({
        name: "get_hazard_profile",
        arguments: locationArgs,
      });
      expect(mcpToolResultSnapshot(hazardRes)).toMatchSnapshot("get_hazard_profile");
      expect(hazardRes.isError).not.toBe(true);
      const hazardText = joinToolText(hazardRes);
      expect(hazardText.length).toBeGreaterThan(10);

      if (chosen.propertyId) {
        expect(hazardText).not.toMatch(/Property ID required for parcel-linked hazards/);

        const permitsRes = await client.callTool({
          name: "get_property_permits",
          arguments: {
            property_id: chosen.propertyId,
            display_address: chosen.displayAddress,
          },
        });
        expect(mcpToolResultSnapshot(permitsRes)).toMatchSnapshot("get_property_permits");
        expect(permitsRes.isError).not.toBe(true);
        const permitsText = joinToolText(permitsRes);
        expect(permitsText.length).toBeGreaterThan(30);
        expect(permitsText).toMatch(/```json/);
      }
    } finally {
      await client.close().catch(() => {});
      await mcp.close().catch(() => {});
    }
    },
    { timeout: 60_000 },
  );
});
