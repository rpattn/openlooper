import { bearing, cumulativeDistances, destination } from "./geometry";
import { randomId } from "./id";
import type { Coordinate, Waypoint, WaypointRole } from "./models";

export type LoopSeed = { id: string; waypoints: Waypoint[] };

/**
 * Divides the target to give the network distance each shaping point should sit
 * at. A triangle's perimeter is roughly 3.5 times the distance out to one of its
 * corners once the network's own wandering is included; the diamond carries one
 * more corner and so sits closer in.
 *
 * Measured over 32 seeds per case, sampling a contour at these fractions gives a
 * median distance error of -0.2% for a 10 km run and -3.5% for a 30 km cycle,
 * against +13% and +15% for the circle these replace.
 */
export const CONTOUR_FRACTIONS = { triangle: 3.5, diamond: 4.6 } as const;
const point = (coordinate: Coordinate, role: WaypointRole): Waypoint => ({
  id: randomId(),
  coordinate,
  role,
});

/** The point on `ring` closest to the given bearing from `start`. */
function ringPointAtBearing(
  start: Coordinate,
  ring: Coordinate[],
  target: number,
): Coordinate {
  let best = ring[0]!;
  let bestOffset = Infinity;
  for (const point of ring) {
    const offset = Math.abs(((bearing(start, point) - target + 540) % 360) - 180);
    if (offset < bestOffset) {
      bestOffset = offset;
      best = point;
    }
  }
  return best;
}

/**
 * Builds candidate loop shapes around `start`. `via` holds points the planner
 * placed by hand: they are visited in the order given and never moved, so the
 * generated shaping points only have to make up the remaining distance.
 */
export function loopSeeds(
  start: Coordinate,
  targetKm: number,
  rotation = 0,
  via: Coordinate[] = [],
  contours?: { triangle?: Coordinate[]; diamond?: Coordinate[] },
): LoopSeed[] {
  const results: LoopSeed[] = [];
  // Straight-line length of the fixed part of the ring; the routed distance is
  // longer, which the refinement pass corrects for.
  const anchoredKm = via.length
    ? (cumulativeDistances([start, ...via, start]).at(-1) ?? 0)
    : 0;
  const shapingKm = Math.max(targetKm * 0.3, targetKm - anchoredKm);
  const triangleRadius = shapingKm / 4.8,
    diamondRadius = shapingKm / 5.7;
  // Continue the ring on from the last hand-placed point rather than from due
  // north, so the shaping points do not send the route back over itself.
  const anchorBearing = via.length ? bearing(start, via.at(-1)!) : 0;
  for (let i = 0; i < 12; i++) {
    const diamond = i >= 8;
    const count = diamond ? 3 : 2;
    const radius = diamond ? diamondRadius : triangleRadius;
    const base = anchorBearing + rotation + i * (360 / 12);
    const bearings = Array.from(
      { length: count },
      (_, j) => base + (j + 1) * (360 / (count + 1)),
    );
    if (i % 2) bearings.reverse();
    // Prefer the measured network boundary; fall back to the circle when the
    // isochrone is unavailable, or when hand-placed points already fix most of
    // the ring and the remaining shaping distance no longer matches the contour.
    const ring = diamond ? contours?.diamond : contours?.triangle;
    const shaping =
      ring && ring.length && !via.length
        ? bearings.map((b) => ringPointAtBearing(start, ring, b))
        : bearings.map((b) => destination(start, radius, b));
    const coords = [start, ...via, ...shaping, start];
    results.push({
      id: `loop-${rotation}-${i}`,
      waypoints: coords.map((coordinate, index) =>
        point(
          coordinate,
          index === 0
            ? "start"
            : index === coords.length - 1
              ? "destination"
              : index <= via.length
                ? "via"
                : "generated",
        ),
      ),
    });
  }
  return results;
}

/** Scales the generated shaping points toward or away from `start`. Hand-placed
 * `via` points keep their position so refinement never drags them off. */
export function scaleLoop(
  seed: LoopSeed,
  start: Coordinate,
  factor: number,
): LoopSeed {
  const points = seed.waypoints.map((w, i) => {
    if (i === 0 || i === seed.waypoints.length - 1)
      return { ...w, coordinate: start };
    if (w.role !== "generated") return w;
    const lat = start.lat + (w.coordinate.lat - start.lat) * factor,
      lon = start.lon + (w.coordinate.lon - start.lon) * factor;
    return { ...w, coordinate: { lat, lon } };
  });
  return { ...seed, id: `${seed.id}-refined`, waypoints: points };
}
