import { coordinateAtDistance, cumulativeDistances } from '../../../../src/domain/geometry';
import { fromDistance, toDistance, type UnitSystem } from '../../../../src/domain/units';
import type { Coordinate, RouteResult } from './models';

export type DistanceMarker = {
  /** How far in the mark is, counted in the planner's chosen unit. */
  km: number;
  coordinate: Coordinate;
};

/** Spacings worth reading off a route, in whole units, in the order tried. */
const SPACINGS = [1, 2, 5, 10, 20];
/** Above this the marks crowd the line rather than measuring it. */
const MOST = 14;

/**
 * Where the whole kilometres fall along a route, each labelled with how far in
 * it is. Reading distance off the line answers "how far to that hill" and
 * "where is halfway" without scrubbing the profile for it — and an unlabelled
 * mark only raises the question of what it is.
 */
export function distanceMarkers(
  route: RouteResult | undefined,
  units: UnitSystem = 'metric',
): DistanceMarker[] {
  if (!route || route.geometry.length < 2) return [];
  // Whole marks are counted in whatever the planner reads, so a route in miles
  // is marked at whole miles rather than at converted kilometres.
  const total = toDistance(route.distanceKm, units);
  if (total < 2) return [];
  const spacing = SPACINGS.find((step) => total / step <= MOST) ?? SPACINGS.at(-1)!;
  const cumulative = cumulativeDistances(route.geometry);
  const marks: DistanceMarker[] = [];
  for (let value = spacing; value < total; value += spacing)
    marks.push({
      km: value,
      coordinate: coordinateAtDistance(route.geometry, cumulative, fromDistance(value, units)),
    });
  return marks;
}
