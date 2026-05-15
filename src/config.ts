import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function applyEnvFile(relPath: string, overrideExisting: boolean): void {
  const abs = resolve(process.cwd(), relPath);
  if (!existsSync(abs)) return;
  const parsed = parseEnvFile(readFileSync(abs, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (!overrideExisting && process.env[k] !== undefined) continue;
    process.env[k] = v;
  }
}

/** Load `.env` then `.env.local` (`.env.local` wins for keys it defines). */
export function loadEnvFiles(): void {
  applyEnvFile(".env", false);
  applyEnvFile(".env.local", true);
}

export function getConfig() {
  loadEnvFiles();
  const port = Number(process.env.PORT ?? "3001");
  const host = process.env.HOST ?? "127.0.0.1";
  const apiKey = process.env.PORTLANDMAPS_API_KEY?.trim();
  const tlsInsecureRaw = process.env.PORTLANDMAPS_TLS_INSECURE?.trim().toLowerCase();
  /** Dev-only: skip TLS certificate verification for PortlandMaps HTTPS (insecure). */
  const portlandMapsTlsInsecure =
    tlsInsecureRaw === "1" || tlsInsecureRaw === "true" || tlsInsecureRaw === "yes";
  return {
    host,
    port: Number.isFinite(port) ? port : 3001,
    portlandMapsApiKey: apiKey && apiKey.length > 0 ? apiKey : undefined,
    baseUrl: "https://www.portlandmaps.com/api",
    portlandMapsTlsInsecure,
  };
}
