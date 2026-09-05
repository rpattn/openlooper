import { destination } from "./geometry";
import { randomId } from "./id";
import type { Coordinate, Waypoint, WaypointRole } from "./models";

export type LoopSeed = { id: string; waypoints: Waypoint[] };
const point = (coordinate: Coordinate, role: WaypointRole): Waypoint => ({
  id: randomId(),
  coordinate,
  role,
});
export function loopSeeds(
  start: Coordinate,
  targetKm: number,
  rotation = 0,
): LoopSeed[] {
  const results: LoopSeed[] = [];
  const triangleRadius = targetKm / 4.8,
    diamondRadius = targetKm / 5.7;
  for (let i = 0; i < 12; i++) {
    const diamond = i >= 8;
    const count = diamond ? 3 : 2;
    const radius = diamond ? diamondRadius : triangleRadius;
    const base = rotation + i * (360 / 12);
    const bearings = Array.from(
      { length: count },
      (_, j) => base + (j + 1) * (360 / (count + 1)),
    );
    if (i % 2) bearings.reverse();
    const coords = [
      start,
      ...bearings.map((b) => destination(start, radius, b)),
      start,
    ];
    results.push({
      id: `loop-${rotation}-${i}`,
      waypoints: coords.map((coordinate, index) =>
        point(
          coordinate,
          index === 0
            ? "start"
            : index === coords.length - 1
              ? "destination"
              : "generated",
        ),
      ),
    });
  }
  return results;
}
export function scaleLoop(
  seed: LoopSeed,
  start: Coordinate,
  factor: number,
): LoopSeed {
  const points = seed.waypoints.map((w, i) => {
    if (i === 0 || i === seed.waypoints.length - 1)
      return { ...w, coordinate: start };
    const lat = start.lat + (w.coordinate.lat - start.lat) * factor,
      lon = start.lon + (w.coordinate.lon - start.lon) * factor;
    return { ...w, coordinate: { lat, lon } };
  });
  return { ...seed, id: `${seed.id}-refined`, waypoints: points };
}
