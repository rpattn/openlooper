import type { Coordinate, ElevationPoint } from "./models";
import { coordinateAtDistance, cumulativeDistances } from "./geometry";

export function elevationProfile(
  geometry: Coordinate[],
  elevations: number[],
  distanceKm: number,
): { points: ElevationPoint[]; ascent: number; descent: number } {
  if (
    !elevations.length ||
    elevations.some((n) => !Number.isFinite(n) || n <= -32000)
  )
    return { points: [], ascent: 0, descent: 0 };
  const filtered = elevations.map((value, i, all) => {
    const sample = [
      all[Math.max(0, i - 1)]!,
      value,
      all[Math.min(all.length - 1, i + 1)]!,
    ];
    return sample.sort((a, b) => a - b)[1]!;
  });
  const cumulative = cumulativeDistances(geometry);
  const totalGeometry = cumulative.at(-1) ?? 0;
  const points = filtered.map((elevationM, i) => {
    const distance =
      filtered.length === 1 ? 0 : (distanceKm * i) / (filtered.length - 1);
    return {
      distanceKm: distance,
      elevationM,
      coordinate: coordinateAtDistance(
        geometry,
        cumulative,
        totalGeometry * (distanceKm ? distance / distanceKm : 0),
      ),
    };
  });
  let ascent = 0,
    descent = 0;
  for (let i = 1; i < filtered.length; i++) {
    const delta = filtered[i]! - filtered[i - 1]!;
    if (Math.abs(delta) >= 1) {
      if (delta > 0) ascent += delta;
      else descent -= delta;
    }
  }
  return { points, ascent: Math.round(ascent), descent: Math.round(descent) };
}
