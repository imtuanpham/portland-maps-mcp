/**
 * Integration / e2e check for PortlandMaps suggest → resolve_address parsing.
 *
 * Loads `.env` then `.env.local` (same as the server). Requires PORTLANDMAPS_API_KEY.
 *
 * Run: `bun test src/e2e/resolveAddress.e2e.test.ts`
 *
 * Optional env:
 *   E2E_RESOLVE_ADDRESS_QUERY — override search text (default: natural-language phrase below)
 */
import { describe, expect, test } from "bun:test";
import { getConfig, loadEnvFiles } from "../config.ts";
import {
  parseSuggestToCandidates,
  PortlandMapsClient,
  PortlandMapsProvider,
} from "../providers/portlandMapsProvider.ts";

loadEnvFiles();

const DEFAULT_QUERY = "show me details on Bancorp building";

function logSection(title: string, body: string): void {
  const line = "=".repeat(Math.min(72, title.length + 8));
  console.log(`\n${line}\n${title}\n${line}\n${body}\n`);
}

describe("resolve_address (PortlandMaps suggest e2e)", () => {
  const cfg = getConfig();
  const hasKey = Boolean(cfg.portlandMapsApiKey);

  test.skipIf(!hasKey)("prints raw suggest + parsed candidates for inspection", async () => {
    const apiKey = cfg.portlandMapsApiKey!;
    const query = (process.env.E2E_RESOLVE_ADDRESS_QUERY ?? DEFAULT_QUERY).trim();

    logSection("Config (from getConfig after loadEnvFiles)", [
      `portlandMapsApiKey: ${apiKey ? `set (${apiKey.length} chars)` : "missing"}`,
      `portlandMapsTlsInsecure: ${cfg.portlandMapsTlsInsecure}`,
      `query: ${JSON.stringify(query)}`,
    ].join("\n"));

    const client = new PortlandMapsClient(apiKey);
    const raw = await client.suggest(query);

    const rawStr = JSON.stringify(raw, null, 2);
    logSection("Raw suggest API JSON", rawStr.length > 24_000 ? `${rawStr.slice(0, 24_000)}\n… [truncated, ${rawStr.length} chars total]` : rawStr);

    if (raw && typeof raw === "object" && (raw as { status?: string }).status === "error") {
      logSection("API returned error shape — resolve_address will yield no candidates", rawStr);
    }

    const parsedDirect = parseSuggestToCandidates(raw);
    logSection(`parseSuggestToCandidates(raw) — ${parsedDirect.length} row(s)`, JSON.stringify(parsedDirect, null, 2));

    const provider = new PortlandMapsProvider(apiKey);
    const viaProvider = await provider.resolveAddress(query);
    logSection(`PortlandMapsProvider.resolveAddress — ${viaProvider.length} candidate(s)`, JSON.stringify(viaProvider, null, 2));

    // Same text blocks the MCP tool would surface (minus HTML card)
    const summary =
      viaProvider.length === 0
        ? `No matches for "${query}". Try a fuller street address inside Portland city limits.`
        : viaProvider.length === 1
          ? "One strong match. Use its property_id and coordinates with get_property_overview / get_hazard_profile."
          : `${viaProvider.length} matches — choose the best property_id + address pair for follow-up tools.`;
    logSection("MCP-style summary (text only)", summary);

    if (parsedDirect.length !== viaProvider.length) {
      logSection(
        "Mismatch note",
        `parseSuggestToCandidates on raw (${parsedDirect.length}) vs provider.resolveAddress (${viaProvider.length}) — unexpected; investigate caching or code path.`,
      );
    }

    expect(parsedDirect.length).toBe(viaProvider.length);
  });
});
