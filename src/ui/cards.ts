import type { AddressCandidate } from "../providers/types.ts";

const accent = "#2d5f3e";
const risk = { low: "#2d7a3e", moderate: "#d4881a", high: "#b8302a", unknown: "#888" };

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function disambiguationCardHtml(candidates: AddressCandidate[]): string {
  const rows = candidates
    .slice(0, 8)
    .map(
      (c, i) => `
      <div style="padding:12px 14px;border-bottom:1px solid #e8e8e8;font-family:system-ui,sans-serif;">
        <div style="font-weight:600;color:#111;">${esc(c.displayAddress)}</div>
        <div style="font-size:13px;color:#666;margin-top:4px;">
          ${c.neighborhood ? esc(c.neighborhood) + " · " : ""}confidence ${(c.confidence * 100).toFixed(0)}%
          ${c.propertyId ? ` · property_id ${esc(c.propertyId)}` : ""}
        </div>
        <div style="font-size:12px;color:#999;margin-top:4px;">Pick #${i + 1} in the structured list for follow-up tools.</div>
      </div>`,
    )
    .join("");
  return `
  <div style="max-width:640px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border:1px solid #e0e0e0;overflow:hidden;background:#fff;">
    <div style="padding:14px 16px;background:${accent};color:#fff;font-family:system-ui,sans-serif;font-weight:600;">Address matches</div>
    ${rows}
    <div style="padding:12px 16px;font-size:13px;color:#666;font-family:system-ui,sans-serif;">None of these? Try a more specific street address or unit.</div>
  </div>`;
}

export function propertyOverviewCardHtml(o: import("../providers/types.ts").PropertyOverview): string {
  const chips = o.hazardChips
    .map((h) => {
      const c = risk[h.level];
      return `<span style="display:inline-block;margin:4px 6px 0 0;padding:4px 8px;border-radius:999px;background:${c}22;color:${c};font-size:12px;font-weight:600;border:1px solid ${c}55;">${esc(h.label)}: ${h.level}</span>`;
    })
    .join("");
  const facts =
    o.yearBuilt || o.squareFeet || o.lastSaleDate || o.lastSalePrice
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;">
          ${o.yearBuilt ? `<div style="background:#f6f7f6;padding:10px;border-radius:8px;"><div style="font-size:11px;color:#666;">Year built</div><div style="font-weight:600;">${esc(String(o.yearBuilt))}</div></div>` : ""}
          ${o.squareFeet ? `<div style="background:#f6f7f6;padding:10px;border-radius:8px;"><div style="font-size:11px;color:#666;">Sq ft</div><div style="font-weight:600;">${esc(String(o.squareFeet))}</div></div>` : ""}
          ${o.lastSaleDate ? `<div style="background:#f6f7f6;padding:10px;border-radius:8px;"><div style="font-size:11px;color:#666;">Last sale</div><div style="font-weight:600;">${esc(o.lastSaleDate)}</div></div>` : ""}
          ${o.lastSalePrice ? `<div style="background:#f6f7f6;padding:10px;border-radius:8px;"><div style="font-size:11px;color:#666;">Last sale price</div><div style="font-weight:600;">${esc(String(o.lastSalePrice))}</div></div>` : ""}
        </div>`
      : `<div style="margin-top:10px;font-size:13px;color:#666;">Assessor facts unavailable without a matched taxlot.</div>`;

  return `
  <div style="max-width:640px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);border:1px solid #e0e0e0;overflow:hidden;background:#fff;font-family:system-ui,sans-serif;">
    <div style="padding:16px;background:linear-gradient(135deg, ${accent}, #1a3d28);color:#fff;">
      <div style="font-size:18px;font-weight:700;">${esc(o.address)}</div>
      <div style="opacity:0.9;margin-top:6px;font-size:14px;">
        ${o.neighborhood ? esc(o.neighborhood) : "Neighborhood unknown"}
        ${o.councilDistrict ? " · " + esc(o.councilDistrict) : ""}
        ${o.zipCode ? " · " + esc(o.zipCode) : ""}
      </div>
    </div>
    <div style="padding:16px;">
      <div style="font-size:13px;color:#444;line-height:1.5;">
        <strong>Zoning:</strong> ${o.zoning ? esc(o.zoning) : "—"}
        ${o.leafDay ? ` · <strong>Leaf day:</strong> ${esc(o.leafDay)}` : ""}
      </div>
      ${facts}
      <div style="margin-top:14px;font-size:12px;color:#555;"><strong>Hazards (summary)</strong></div>
      <div style="margin-top:4px;">${chips}</div>
      <div style="margin-top:14px;font-size:13px;color:#444;">
        <div><strong>Nearest school:</strong> ${o.nearestSchool ? esc(o.nearestSchool) : "—"}</div>
        <div style="margin-top:4px;"><strong>Nearest park:</strong> ${o.nearestPark ? esc(o.nearestPark) : "—"}</div>
      </div>
      <div style="margin-top:16px;font-size:12px;color:#888;">Call <code>get_hazard_profile</code> for narrative hazard detail.</div>
    </div>
  </div>`;
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
  "hazard-liquefaction": "Earthquake — liquefaction",
  "hazard-earthquake-cascadia": "Cascadia subduction",
  "hazard-landslide": "Landslide",
  "hazard-flood": "Flood",
  "hazard-steep-slope": "Steep slope",
  "hazard-wild-lands-fire": "Wildland fire",
};

export function hazardPanelHtml(profile: import("../providers/types.ts").HazardProfile): string {
  const cards = hazardOrder
    .map((key) => {
      const h = profile.hazards[key];
      if (!h) return "";
      const c = risk[h.level];
      const title = hazardTitles[key] ?? key;
      return `
      <div style="border:1px solid #e4e4e4;border-radius:8px;padding:12px;background:#fafafa;font-family:system-ui,sans-serif;">
        <div style="font-weight:700;font-size:14px;color:#222;">${esc(title)}</div>
        <div style="margin-top:6px;font-size:12px;font-weight:700;color:${c};text-transform:uppercase;">${esc(h.level)}</div>
        <div style="margin-top:8px;font-size:13px;color:#444;line-height:1.45;">${esc(h.label)}</div>
        <div style="margin-top:8px;font-size:10px;color:#999;">${esc(h.source)}</div>
      </div>`;
    })
    .join("");
  return `
  <div style="max-width:640px;font-family:system-ui,sans-serif;">
    <div style="margin-bottom:10px;font-weight:600;color:${accent};">Natural hazards — ${esc(profile.address)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${cards}</div>
  </div>`;
}
