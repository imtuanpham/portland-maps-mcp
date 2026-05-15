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

export type PermitRecord = {
  /** PortlandMaps "permit" label (e.g. "Facility Permit", "Enforcement: Housing"). */
  permitLabel: string;
  applicationNumber?: string;
  /** PortlandMaps "type" (work / structure category). */
  category?: string;
  work?: string;
  status?: string;
  lastAction?: string;
  ivrNumber?: string;
  address?: string;
  /** True when PortlandMaps classifies the row as an enforcement-style case. */
  isCodeEnforcement: boolean;
};

function firstArray(json: unknown): unknown[] | undefined {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["related", "candidates", "results", "data", "suggestions", "records", "rows", "items"]) {
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

export function classifyCodeEnforcement(permitLabel: string, category?: string): boolean {
  const p = permitLabel.toLowerCase();
  const c = (category ?? "").toLowerCase();
  if (p.startsWith("enforcement:")) return true;
  if (p.includes("enforcement:")) return true;
  if (/\benforcement\b/.test(c) && /\b(code|housing|nuisance|zoning|signs)\b/.test(c)) return true;
  return false;
}

export function parsePermitRows(blob: unknown): PermitRecord[] {
  const inner = unwrapDetail(blob);
  const rows = firstArray(inner) ?? firstArray(blob);
  if (!rows) return [];
  const out: PermitRecord[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const attr = row.attributes;
    if (attr && typeof attr === "object") {
      Object.assign(row, attr as Record<string, unknown>);
    }
    const permitLabel =
      pickString(row, ["permit", "PERMIT", "permit_type", "permitType"]) ?? "Unknown permit";
    const category = pickString(row, ["type", "TYPE", "permit_category"]);
    const isCodeEnforcement = classifyCodeEnforcement(permitLabel, category);
    out.push({
      permitLabel,
      applicationNumber: pickString(row, ["application_number", "APPLICATION_NUMBER", "applicationNumber"]),
      category,
      work: pickString(row, ["work", "WORK", "work_type"]),
      status: pickString(row, ["status", "STATUS", "permit_status"]),
      lastAction: pickString(row, ["last_action", "LAST_ACTION", "lastAction", "issued", "ISSUED"]),
      ivrNumber: pickString(row, ["ivr_number", "IVR_NUMBER", "ivrNumber"]) ?? pickNumberAsString(row, ["ivr_number"]),
      address: pickString(row, ["address", "ADDRESS", "location"]),
      isCodeEnforcement,
    });
  }
  return out;
}

function pickNumberAsString(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
  }
  return undefined;
}

export function buildPermitsBuyerSummary(rows: PermitRecord[], displayAddress?: string): string {
  const n = rows.length;
  const enf = rows.filter((r) => r.isCodeEnforcement).length;
  const openish = rows.filter((r) => {
    const s = (r.status ?? "").toLowerCase();
    return s && !/\b(final|closed|completed|void|expired|cancel|withdrawn)\b/.test(s);
  }).length;
  const parts: string[] = [];
  if (displayAddress) parts.push(`${displayAddress} — ${n} permit / case row(s) on file.`);
  else parts.push(`${n} permit / case row(s) on file.`);
  if (enf > 0) {
    parts.push(
      `${enf} look like PortlandMaps code enforcement / regulatory tracks (building, housing, nuisance, etc.) — review status and descriptions, not just building permits.`,
    );
  } else {
    parts.push("No rows were tagged as dedicated enforcement categories; still scan types for compliance / tree / ROW activity.");
  }
  if (openish > 0) parts.push(`Roughly ${openish} row(s) have a status that may still be in progress (heuristic).`);
  return parts.join(" ");
}
