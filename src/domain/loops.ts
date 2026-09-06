import { bearing, cumulativeDistances, destination } from "./geometry";
import { randomId } from "./id";
import type { Coordinate, Waypoint, WaypointRole } from "./models";

export type LoopSeed = { id: string; waypoints: Waypoint[] };
const point = (coordinate: Coordinate, role: WaypointRole): Waypoint => ({
  id: randomId(),
  coordinate,
  role,
});

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
    const shaping = bearings.map((b) => destination(start, radius, b));
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
