import type { Coordinate } from "./models";

const R = 6371;
const rad = (n: number) => (n * Math.PI) / 180;
const deg = (n: number) => (n * 180) / Math.PI;
export function distanceKm(a: Coordinate, b: Coordinate): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function destination(
  start: Coordinate,
  distance: number,
  bearing: number,
): Coordinate {
  const d = distance / R;
  const br = rad(bearing);
  const lat1 = rad(start.lat);
  const lon1 = rad(start.lon);
  const lat = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lon =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat),
    );
  return { lat: deg(lat), lon: ((deg(lon) + 540) % 360) - 180 };
}
export function cumulativeDistances(points: Coordinate[]): number[] {
  const values = [0];
  for (let i = 1; i < points.length; i++)
    values.push((values[i - 1] ?? 0) + distanceKm(points[i - 1]!, points[i]!));
  return values;
}
export function coordinateAtDistance(
  points: Coordinate[],
  cumulative: number[],
  target: number,
): Coordinate {
  if (!points.length) return { lat: 0, lon: 0 };
  const index = cumulative.findIndex((d) => d >= target);
  if (index <= 0) return points[0]!;
  const a = points[index - 1]!;
  const b = points[index]!;
  const span = cumulative[index]! - cumulative[index - 1]!;
  const t = span ? (target - cumulative[index - 1]!) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}
export function routeBounds(points: Coordinate[]): [Coordinate, Coordinate] {
  return points.reduce<[Coordinate, Coordinate]>(
    (b, p) => [
      { lat: Math.min(b[0].lat, p.lat), lon: Math.min(b[0].lon, p.lon) },
      { lat: Math.max(b[1].lat, p.lat), lon: Math.max(b[1].lon, p.lon) },
    ],
    [
      { lat: 90, lon: 180 },
      { lat: -90, lon: -180 },
    ],
  );
}
export function closestSegment(
  points: Coordinate[],
  point: Coordinate,
): number {
  let best = 0,
    bestDistance = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!,
      b = points[i + 1]!;
    const x = point.lon,
      y = point.lat,
      dx = b.lon - a.lon,
      dy = b.lat - a.lat;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((x - a.lon) * dx + (y - a.lat) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    const d = (x - (a.lon + t * dx)) ** 2 + (y - (a.lat + t * dy)) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}
