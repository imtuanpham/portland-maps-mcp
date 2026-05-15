/** Web Mercator (EPSG:3857) meters from WGS84 lng/lat */
export function lngLatToWebMercator(lng: number, lat: number): { x: number; y: number } {
  const x = (lng * 20037508.34) / 180;
  let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
  y = (y * 20037508.34) / 180;
  return { x, y };
}

export function webMercatorDetailId(lng: number, lat: number): string {
  const { x, y } = lngLatToWebMercator(lng, lat);
  return `${Math.round(x)}_${Math.round(y)}`;
}
