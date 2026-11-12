/**
 * SafeHer — geo helpers.
 *
 * DEMO_CENTER is the only coordinate hardcoded anywhere outside seed.sql.
 * To move the demo to another city, change this and the lat/lng columns
 * in supabase/seed.sql. Nothing else needs to know.
 */

export const DEMO_CENTER = {
  name: 'Chandigarh',
  lat: 30.7333,
  lng: 76.7794,
  zoom: 12.2,
} as const;

/**
 * A handful of named spots used by scripts/simulate-sos.ts so you can
 * say "fire one from Sector 17" instead of pasting coordinates. Each is
 * near a *different* station, which is what makes the routing visible.
 */
export const DEMO_SPOTS: Record<string, { lat: number; lng: number; label: string }> = {
  'sector-17': { lat: 30.7412, lng: 76.7831, label: 'Sector 17 Plaza' },
  'sector-14': { lat: 30.7589, lng: 76.7671, label: 'Panjab University, Sector 14' },
  'sector-34': { lat: 30.7201, lng: 76.7699, label: 'Sector 34 Market' },
  'sector-26': { lat: 30.7178, lng: 76.8061, label: 'Sector 26 Grain Market' },
  'sector-39': { lat: 30.7066, lng: 76.7512, label: 'Sector 39 Bus Stand' },
  manimajra: { lat: 30.7291, lng: 76.8398, label: 'Manimajra Market' },
  'rock-garden': { lat: 30.7525, lng: 76.8052, label: 'Rock Garden' },
  'sukhna-lake': { lat: 30.7421, lng: 76.8188, label: 'Sukhna Lake' },
};

const R = 6_371_000; // metres
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. Client-side display only — routing is server-side. */
export function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Offset a point by metres — used by the simulator to walk a track. */
export function offsetMetres(
  p: { lat: number; lng: number },
  northM: number,
  eastM: number,
): { lat: number; lng: number } {
  return {
    lat: p.lat + (northM / R) * (180 / Math.PI),
    lng: p.lng + (eastM / (R * Math.cos(rad(p.lat)))) * (180 / Math.PI),
  };
}

export function bearingDegrees(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}
