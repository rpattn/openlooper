import type { ElevationPoint } from '@/domain/models';

export type ElevationSummary = {
  min: number;
  max: number;
  range: number;
  distanceKm: number;
};

/** Evenly thins the profile so the chart stays smooth without plotting every
 * 30 m sample, always keeping the first and last point. */
export function sampleElevation(points: ElevationPoint[], limit = 90): ElevationPoint[] {
  if (points.length <= limit) return points;
  const step = (points.length - 1) / (limit - 1);
  const sampled = Array.from({ length: limit }, (_, i) => points[Math.round(i * step)]!);
  sampled[sampled.length - 1] = points.at(-1)!;
  return sampled;
}

export function elevationSummary(points: ElevationPoint[]): ElevationSummary {
  const values = points.map((point) => point.elevationM);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    max,
    range: Math.max(1, max - min),
    distanceKm: points.at(-1)?.distanceKm ?? 0,
  };
}

/** Maps a horizontal touch position to the nearest plotted sample. */
export function indexAtRatio(count: number, ratio: number): number {
  if (count < 2) return 0;
  return Math.round(Math.max(0, Math.min(1, ratio)) * (count - 1));
}
