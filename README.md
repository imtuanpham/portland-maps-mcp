# portlandMapsMcp

**Bun + TypeScript** MCP server over **Streamable HTTP** with **Phase 2 PortlandMaps tools**: `ping`, `resolve_address`, `get_property_overview`, `get_hazard_profile`.

## Setup

1. Copy [`.env.example`](.env.example) to **`.env.local`** and set **`PORTLANDMAPS_API_KEY`** (server key from the City of Portland).
2. Defaults: `HOST=127.0.0.1`, `PORT=3001`.

## Run

```bash
bun install
bun src/server.ts
```

- Health: `http://127.0.0.1:3001/health` (includes `tools`, `portlandmapsKey`)
- MCP: `http://127.0.0.1:3001/mcp`

The server sets **`idleTimeout: 0`** on `Bun.serve` so MCP’s SSE stream is not closed after Bun’s default **10 seconds** of idle (see [Bun server docs](https://bun.com/docs/runtime/http/server#idletimeout)).

## Tools (phase 2)

| Tool | Purpose |
|------|--------|
| `ping` | Confirms server + whether API key is loaded |
| `resolve_address` | PortlandMaps `/api/suggest/` → candidates + JSON + HTML card |
| `get_property_overview` | Assessor, zoning, leaf day, school/park, hazard chips (`lat`/`lng` required; `property_id` for parcel data) |
| `get_hazard_profile` | Six parcel hazard layers via `/api/detail/` |

After `resolve_address`, pass `display_address`, `property_id`, `lat`, and `lng` from the JSON into the other tools.

## TLS errors (`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`)

That means **HTTPS certificate verification failed**: Bun could not find a trusted path from your machine to the server’s certificate (issuer chain).

**Try in order:**

1. **Upgrade Bun** — some 1.3.x builds had regressions around system CAs; newer patches often fix `fetch` to public sites.
2. **Point at a CA bundle** (proper fix on locked-down networks):
   ```bash
   export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem
   bun src/server.ts
   ```
   On macOS you can build a PEM from Keychain or use a bundle from your org / OpenSSL / `certifi`.
3. **Hackathon-only workaround** — in `.env.local` set **`PORTLANDMAPS_TLS_INSECURE=1`**. The client then uses `fetch(..., { tls: { rejectUnauthorized: false } })` for PortlandMaps only. **Do not use in production**; it disables MITM protection for that API host.

## Cursor (HTTP)

```json
{
  "mcpServers": {
    "portlandMapsMcp": {
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

**Note:** There is **no session store** yet — each HTTP request gets a new transport + server. Multi-step Streamable HTTP from some hosts can return **`-32601`**; if so, add session routing (`mcp-session-id`) or use **stdio** MCP.

## Layout

- [`src/server.ts`](src/server.ts) — Bun HTTP + `/mcp` + `/health`
- [`src/registerTools.ts`](src/registerTools.ts) — `createMcpServer(apiKey)`
- [`src/providers/portlandMapsProvider.ts`](src/providers/portlandMapsProvider.ts) — suggest + detail + normalization
- [`src/ui/cards.ts`](src/ui/cards.ts) — HTML cards for tools
- [`docs/hackathon-plan.md`](docs/hackathon-plan.md) — phased roadmap
