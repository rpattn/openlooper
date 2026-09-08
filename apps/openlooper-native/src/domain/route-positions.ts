import {
  closestSegment,
  coordinateAtDistance,
  cumulativeDistances,
} from '../../../../src/domain/geometry';
import type { Coordinate, RouteResult, Waypoint } from './models';

/** How far either side of the grab the pulled section is anchored, in km. */
const BAND_KM = 0.08;

/**
 * The stretch of route drawn either side of a reshape in progress, so pulling
 * the line reads as bending that part of it rather than as a stray rubber band
 * hung off nothing.
 */
export function pulledSection(
  geometry: Coordinate[],
  at: Coordinate,
): [Coordinate, Coordinate] {
  if (geometry.length < 2) return [at, at];
  const cumulative = cumulativeDistances(geometry);
  const total = cumulative.at(-1) ?? 0;
  const km = cumulative[closestSegment(geometry, at)] ?? 0;
  return [
    coordinateAtDistance(geometry, cumulative, Math.max(0, km - BAND_KM)),
    coordinateAtDistance(geometry, cumulative, Math.min(total, km + BAND_KM)),
  ];
}

/** Where along the route a coordinate falls, for placing the profile cursor. */
export function distanceAlong(geometry: Coordinate[], at: Coordinate): number {
  if (geometry.length < 2) return 0;
  const cumulative = cumulativeDistances(geometry);
  const index = closestSegment(geometry, at);
  return cumulative[index] ?? 0;
}

/**
 * Where each waypoint sits along the route's geometry, as an index into it.
 *
 * Valhalla is asked for intermediate points as `through` rather than `break`,
 * which keeps the route continuous but means it comes back as a single leg no
 * matter how many points shaped it. The legs therefore cannot say which stretch
 * of route belongs to which point, and the geometry has to be asked instead.
 */
export function waypointAnchors(
  route: RouteResult,
  points: Waypoint[],
  /** True when the route returns to its start, so the list of points stops
   * short of the geometry's end rather than finishing at it. */
  closed = false,
): number[] {
  let floor = 0;
  return points.map((point, index) => {
    if (index === 0) return 0;
    if (!closed && index === points.length - 1) return Math.max(floor, route.geometry.length - 1);
    // Kept in order: a point can only sit further along than the one before it,
    // which also settles the ambiguity where a route doubles back on itself.
    floor = Math.max(floor, closestSegment(route.geometry, point.coordinate));
    return floor;
  });
}

/**
 * Where a point dropped beside the route belongs in the order: after every
 * existing point the route reaches before that spot. The first and last places
 * belong to the start and finish, so an inserted point never displaces them.
 */
export function insertionIndex(
  route: RouteResult,
  points: Waypoint[],
  at: Coordinate,
  last: number,
  closed = false,
): number {
  const segment = closestSegment(route.geometry, at);
  const anchors = waypointAnchors(route, points, closed);
  const before = anchors.filter(
    (anchor, index) => (closed || index < points.length - 1) && anchor < segment,
  ).length;
  return Math.min(Math.max(1, before), last);
}

/**
 * How far the route covers between each point and the one before it. Derived
 * from the geometry for the same reason as the anchors: there is only ever one
 * leg to read.
 */
export function legDistances(
  route: RouteResult,
  points: Waypoint[],
  closed = false,
): (number | undefined)[] {
  const cumulative = cumulativeDistances(route.geometry);
  const total = cumulative.at(-1) ?? 0;
  const anchors = waypointAnchors(route, points, closed);
  return points.map((_, index) => {
    // A loop's first row is also its last, so the distance shown against it is
    // the run home from the final point rather than nothing at all. It is what
    // makes the legs add up to the route.
    if (index === 0)
      return closed ? total - (cumulative[anchors.at(-1)!] ?? 0) : undefined;
    return (cumulative[anchors[index]!] ?? 0) - (cumulative[anchors[index - 1]!] ?? 0);
  });
}
