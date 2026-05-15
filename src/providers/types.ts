export type RiskLevel = {
  level: "low" | "moderate" | "high" | "unknown";
  label: string;
  source: string;
};

export type AddressCandidate = {
  displayAddress: string;
  propertyId?: string;
  stateId?: string;
  lat: number;
  lng: number;
  xWebMercator?: number;
  yWebMercator?: number;
  neighborhood?: string;
  confidence: number;
};

export type PropertyOverview = {
  address: string;
  lat: number;
  lng: number;
  neighborhood?: string;
  councilDistrict?: string;
  zipCode?: string;
  yearBuilt?: number;
  squareFeet?: number;
  lastSaleDate?: string;
  lastSalePrice?: number;
  zoning?: string;
  leafDay?: string;
  nearestSchool?: string;
  nearestPark?: string;
  hazardChips: { key: string; label: string; level: RiskLevel["level"] }[];
};

export type HazardProfile = {
  address: string;
  lat: number;
  lng: number;
  hazards: Record<string, RiskLevel>;
};
