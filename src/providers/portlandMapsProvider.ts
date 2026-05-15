import { stableKey, TtlCache } from "../cache.ts";
import { getConfig } from "../config.ts";
import { webMercatorDetailId } from "../geo.ts";
import type {
  AddressCandidate,
  HazardProfile,
  PropertyOverview,
  RiskLevel,
} from "./types.ts";

const suggestCache = new TtlCache<unknown>();
const detailCache = new TtlCache<unknown>();

export const HAZARD_DETAIL_TYPES = [
  "hazard-liquefaction",
  "hazard-earthquake-cascadia",
  "hazard-landslide",
  "hazard-flood",
  "hazard-steep-slope",
  "hazard-wild-lands-fire",
] as const;

export type HazardKey = (typeof HAZARD_DETAIL_TYPES)[number];

function firstArray(json: unknown): unknown[] | undefined {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["candidates", "results", "data", "suggestions", "records", "rows", "items"]) {
      const v = o[k];
      if (Array.isArray(v)) return v;
    }
  }
  return undefined;
}

function pickString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(row: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function pickLngLat(row: Record<string, unknown>): { lat: number; lng: number } | undefined {
  const coords = row.coordinates ?? row.Coordinates;
  if (coords && typeof coords === "object") {
    const o = coords as Record<string, unknown>;
    const x = pickNumber(o, ["x", "X", "lon", "lng", "longitude"]);
    const y = pickNumber(o, ["y", "Y", "lat", "latitude"]);
    if (x !== undefined && y !== undefined && Math.abs(x) <= 180 && Math.abs(y) <= 90) {
      return { lng: x, lat: y };
    }
  }
  const lat = pickNumber(row, ["latitude", "lat", "LATITUDE", "Latitude", "y"]);
  const lng = pickNumber(row, ["longitude", "lng", "lon", "LONGITUDE", "Longitude", "x"]);
  if (lat === undefined || lng === undefined) return undefined;
  if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  return undefined;
}

function matchConfidence(row: Record<string, unknown>): number {
  const mt = pickString(row, ["match_type", "matchType", "type", "locator_type"]);
  if (!mt) return 0.75;
  const t = mt.toLowerCase();
  if (t.includes("exact") || t.includes("point")) return 0.95;
  if (t.includes("intersection")) return 0.65;
  if (t.includes("landmark")) return 0.6;
  if (t.includes("partial") || t.includes("street")) return 0.72;
  return 0.78;
}

export function parseSuggestToCandidates(json: unknown): AddressCandidate[] {
  const rows = firstArray(json);
  if (!rows) return [];
  const out: AddressCandidate[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const top = raw as Record<string, unknown>;
    const row: Record<string, unknown> = { ...top };
    const attr = top.attributes;
    if (attr && typeof attr === "object") {
      Object.assign(row, attr as Record<string, unknown>);
    }
    const loc = top.location;
    if (loc && typeof loc === "object") {
      const lo = loc as Record<string, unknown>;
      const lx = pickNumber(lo, ["x", "X"]);
      const ly = pickNumber(lo, ["y", "Y"]);
      if (
        lx !== undefined &&
        ly !== undefined &&
        pickNumber(row, ["x_web_mercator", "X_WEB_MERCATOR", "xWebMercator"]) === undefined
      ) {
        row.x_web_mercator = lx;
        row.y_web_mercator = ly;
      }
    }
    const display =
      pickString(row, [
        "full_address",
        "FULL_ADDRESS",
        "address",
        "ADDRESS",
        "matched_address",
        "label",
        "name",
      ]) ?? "Unknown address";
    const ll = pickLngLat(row);
    if (!ll) continue;
    const { lat, lng } = ll;
    const xwm = pickNumber(row, ["x_web_mercator", "X_WEB_MERCATOR", "xWebMercator"]);
    const ywm = pickNumber(row, ["y_web_mercator", "Y_WEB_MERCATOR", "yWebMercator"]);
    const propertyId = pickString(row, ["property_id", "PROPERTY_ID", "propertyId"]);
    const stateId = pickString(row, ["state_id", "STATE_ID", "stateId"]);
    const neighborhood = pickString(row, ["neighborhood", "NEIGHBORHOOD", "Neighborhood"]);
    out.push({
      displayAddress: display,
      propertyId,
      stateId,
      lat,
      lng,
      xWebMercator: xwm,
      yWebMercator: ywm,
      neighborhood,
      confidence: matchConfidence(row),
    });
  }
  return out;
}

function unwrapDetail(json: unknown): unknown {
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (typeof o.status === "string" && o.status === "error") return json;
    for (const k of ["result", "data", "detail", "record"]) {
      if (o[k] !== undefined) return o[k];
    }
  }
  return json;
}

export function collectStringsByKeyHint(data: unknown, hint: RegExp): string[] {
  const found: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 4 || node === null || node === undefined) return;
    if (typeof node === "string" && node.trim().length > 0 && hint.test(node)) {
      found.push(node.trim());
    }
    if (typeof node === "number" && hint.test(String(node))) {
      found.push(String(node));
    }
    if (Array.isArray(node)) {
      for (const x of node) visit(x, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (hint.test(k) && typeof v === "string" && v.trim()) found.push(v.trim());
        if (depth < 2) visit(v, depth + 1);
      }
    }
  };
  visit(data, 0);
  return [...new Set(found)];
}

export function extractIdLike(data: unknown, keyHints: RegExp): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const stack: unknown[] = [data];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (keyHints.test(k)) {
        if (typeof v === "string" || typeof v === "number") return String(v);
      }
      if (typeof v === "object" && v !== null) stack.push(v);
    }
  }
  return undefined;
}

function mapHazardStrings(detailType: string, blob: unknown): RiskLevel {
  const text = JSON.stringify(blob).toLowerCase();
  const source = `portlandmaps:${detailType}`;
  const labelFromApi =
    collectStringsByKeyHint(blob, /zone|risk|hazard|level|class|category|fema|slope|wui|liquef/i)[0] ??
    "See detail response";

  let level: RiskLevel["level"] = "unknown";
  if (/\bhigh\b|zone\s*a\b|zone\s*v\b|severe|extreme/.test(text)) level = "high";
  else if (/\bmoderate\b|medium|shaded|moderate\s+to\s+high/.test(text)) level = "moderate";
  else if (/\blow\b|minimal|zone\s*x\b(?!\s*shaded)/.test(text)) level = "low";

  return { level, label: labelFromApi.slice(0, 200), source };
}

export class PortlandMapsClient {
  constructor(private readonly apiKey: string) {}

  private async fetchJson(url: string, cache: TtlCache<unknown>): Promise<unknown> {
    const key = stableKey([url]);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const { portlandMapsTlsInsecure } = getConfig();
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      ...(portlandMapsTlsInsecure ? { tls: { rejectUnauthorized: false } } : {}),
    } as RequestInit);
    const limit = res.headers.get("x-rate-limit-limit");
    const remaining = res.headers.get("x-rate-limit-remaining");
    if (limit || remaining) {
      console.error(`[portlandmaps] rate-limit limit=${limit} remaining=${remaining}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { status: "error", error: { message: "non-json response" } };
    }
    if (!res.ok) {
      return {
        status: "error",
        httpStatus: res.status,
        body,
      };
    }
    cache.set(key, body);
    return body;
  }

  async suggest(query: string): Promise<unknown> {
    const { baseUrl } = getConfig();
    const u = new URL(`${baseUrl}/suggest/`);
    u.searchParams.set("query", query);
    u.searchParams.set("city", "Portland");
    u.searchParams.set("count", "8");
    u.searchParams.set("intersections", "1");
    u.searchParams.set("landmarks", "1");
    u.searchParams.set("alt_coords", "1");
    u.searchParams.set("alt_ids", "1");
    u.searchParams.set("format", "json");
    u.searchParams.set("api_key", this.apiKey);
    return this.fetchJson(u.toString(), suggestCache);
  }

  async detail(detailType: string, detailId: string, sections = "*"): Promise<unknown> {
    const { baseUrl } = getConfig();
    const u = new URL(`${baseUrl}/detail/`);
    u.searchParams.set("detail_type", detailType);
    u.searchParams.set("detail_id", detailId);
    u.searchParams.set("sections", sections);
    u.searchParams.set("format", "json");
    u.searchParams.set("api_key", this.apiKey);
    return this.fetchJson(u.toString(), detailCache);
  }
}

export class PortlandMapsProvider {
  private readonly client: PortlandMapsClient;

  constructor(apiKey: string) {
    this.client = new PortlandMapsClient(apiKey);
  }

  async resolveAddress(query: string): Promise<AddressCandidate[]> {
    try {
      const json = await this.client.suggest(query);
      if (json && typeof json === "object" && (json as { status?: string }).status === "error") {
        console.error("[portlandmaps] suggest error", JSON.stringify(json).slice(0, 500));
        return [];
      }
      return parseSuggestToCandidates(json);
    } catch (e) {
      console.error("[portlandmaps] suggest exception", e);
      return [];
    }
  }

  async getPropertyOverview(
    c: AddressCandidate,
  ): Promise<{ overview: PropertyOverview; rawNotes?: string }> {
    const propertyId = c.propertyId;
    const xy =
      c.xWebMercator !== undefined && c.yWebMercator !== undefined
        ? `${Math.round(c.xWebMercator)}_${Math.round(c.yWebMercator)}`
        : webMercatorDetailId(c.lng, c.lat);

    const parallel: Promise<readonly [string, unknown]>[] = [];
    if (propertyId) {
      parallel.push(
        this.client.detail("assessor", propertyId).then((raw) => ["assessor", raw] as const),
        this.client.detail("zoning", propertyId).then((raw) => ["zoning", raw] as const),
        this.client.detail("leaf-day", propertyId).then((raw) => ["leaf-day", raw] as const),
        this.client.detail("property", propertyId).then((raw) => ["property", raw] as const),
      );
      for (const t of HAZARD_DETAIL_TYPES) {
        parallel.push(this.client.detail(t, propertyId).then((raw) => [t, raw] as const));
      }
    }
    parallel.push(
      this.client.detail("school", xy).then((raw) => ["school", raw] as const),
      this.client.detail("park", xy).then((raw) => ["park", raw] as const),
    );

    const settled = await Promise.allSettled(parallel);
    const byType: Record<string, unknown> = {};
    for (const s of settled) {
      if (s.status === "fulfilled") {
        const [t, raw] = s.value;
        byType[t] = raw;
      }
    }

    const assessor = unwrapDetail(byType["assessor"]);
    const zoningBlob = unwrapDetail(byType["zoning"]);
    const leafBlob = unwrapDetail(byType["leaf-day"]);
    const propertyBlob = unwrapDetail(byType["property"]);
    const schoolBlob = unwrapDetail(byType["school"]);
    const parkBlob = unwrapDetail(byType["park"]);

    const zoning =
      collectStringsByKeyHint(zoningBlob, /zone|zoning|ez_/i)[0] ??
      extractIdLike(zoningBlob, /ZONE|zoning/i);

    const leafDay =
      collectStringsByKeyHint(leafBlob, /leaf|day|collection/i)[0] ??
      extractIdLike(leafBlob, /leaf/i);

    const assessorObj =
      assessor && typeof assessor === "object" ? (assessor as Record<string, unknown>) : {};
    const yearBuilt = pickNumber(assessorObj, ["year_built", "YEAR_BUILT", "yearBuilt", "yr_built"]);
    const squareFeet = pickNumber(assessorObj, [
      "square_feet",
      "SQUARE_FEET",
      "sqft",
      "building_square_feet",
    ]);
    const lastSaleDate = pickString(assessorObj, ["sale_date", "SALE_DATE", "last_sale_date"]);
    const lastSalePrice = pickNumber(assessorObj, [
      "sale_price",
      "SALE_PRICE",
      "last_sale_price",
      "market_value",
    ]);

    const propertyObj =
      propertyBlob && typeof propertyBlob === "object"
        ? (propertyBlob as Record<string, unknown>)
        : {};
    const zipCode = pickString(propertyObj, ["zip", "ZIP", "zip_code", "ZIP_CODE", "postal"]);

    let neighborhood =
      c.neighborhood ?? collectStringsByKeyHint(propertyBlob, /neighborhood|nbrhood|assoc/i)[0];
    let councilDistrict = collectStringsByKeyHint(propertyBlob, /council|district|commissioner/i)[0];

    const neighborhoodId = extractIdLike(propertyBlob, /neighborhood.*id|nbrhood.*id|^OBJECTID$/i);
    const councilDistrictId = extractIdLike(propertyBlob, /council.*id|district.*id/i);

    if (neighborhoodId) {
      const nb = unwrapDetail(await this.client.detail("neighborhood", neighborhoodId));
      neighborhood =
        neighborhood ?? collectStringsByKeyHint(nb, /name|label|title/i)[0] ?? neighborhood;
    }
    if (councilDistrictId) {
      const cd = unwrapDetail(await this.client.detail("council-district", councilDistrictId));
      councilDistrict =
        councilDistrict ?? collectStringsByKeyHint(cd, /district|rep|name/i)[0] ?? councilDistrict;
    }

    const nearestSchool =
      collectStringsByKeyHint(schoolBlob, /school|name|facility/i)[0] ??
      extractIdLike(schoolBlob, /NAME|school/i);
    const nearestPark =
      collectStringsByKeyHint(parkBlob, /park|name|site/i)[0] ??
      extractIdLike(parkBlob, /NAME|park/i);

    const hazardChips: PropertyOverview["hazardChips"] = [];
    for (const t of HAZARD_DETAIL_TYPES) {
      const raw = byType[t];
      const rl = propertyId
        ? mapHazardStrings(t, unwrapDetail(raw))
        : {
            level: "unknown" as const,
            label: "Match an address with property_id for parcel hazards",
            source: `portlandmaps:${t}`,
          };
      hazardChips.push({
        key: t,
        label: shortHazardLabel(t),
        level: rl.level,
      });
    }

    const overview: PropertyOverview = {
      address: c.displayAddress,
      lat: c.lat,
      lng: c.lng,
      neighborhood,
      councilDistrict,
      zipCode,
      yearBuilt,
      squareFeet,
      lastSaleDate,
      lastSalePrice,
      zoning,
      leafDay,
      nearestSchool,
      nearestPark,
      hazardChips,
    };

    return { overview };
  }

  async getHazardProfile(c: AddressCandidate): Promise<HazardProfile> {
    const propertyId = c.propertyId;
    const hazards: Record<string, RiskLevel> = {};
    if (!propertyId) {
      for (const t of HAZARD_DETAIL_TYPES) {
        hazards[t] = {
          level: "unknown",
          label: "Property ID required for parcel-linked hazards",
          source: `portlandmaps:${t}`,
        };
      }
      return { address: c.displayAddress, lat: c.lat, lng: c.lng, hazards };
    }
    const results = await Promise.allSettled(
      HAZARD_DETAIL_TYPES.map(async (t) => {
        const raw = await this.client.detail(t, propertyId);
        return [t, mapHazardStrings(t, unwrapDetail(raw))] as const;
      }),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        const [t, rl] = r.value;
        hazards[t] = rl;
      }
    }
    return { address: c.displayAddress, lat: c.lat, lng: c.lng, hazards };
  }
}

function shortHazardLabel(t: string): string {
  const map: Record<string, string> = {
    "hazard-liquefaction": "Liquefaction",
    "hazard-earthquake-cascadia": "Cascadia EQ",
    "hazard-landslide": "Landslide",
    "hazard-flood": "Flood",
    "hazard-steep-slope": "Steep slope",
    "hazard-wild-lands-fire": "Wildfire",
  };
  return map[t] ?? t;
}
