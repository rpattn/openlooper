import { waypoint } from './models';
import type { Coordinate, PlannerState, Waypoint, WaypointRole } from './models';

/**
 * Drops a loop's closing point. A loop finishes where it starts, so that point
 * follows from the start rather than being edited on its own.
 */
export function openLoop(points: Waypoint[]): Waypoint[] {
  return points.length > 1 && points.at(-1)?.role === 'destination'
    ? points.slice(0, -1)
    : points;
}

/** Adds the closing point back, at wherever the start now is. */
export function closedLoop(points: Waypoint[]): Waypoint[] {
  const start = points[0];
  if (!start || points.length < 2) return points;
  return [...points, waypoint(start.coordinate, 'destination')];
}

/** The points the planner sees and may reorder, remove or drag. */
export function editableWaypoints(state: PlannerState): Waypoint[] {
  return state.plan.mode === 'loop'
    ? openLoop(state.plan.waypoints)
    : state.plan.waypoints;
}

/**
 * Coordinates a freshly generated loop has to pass through. Only points the
 * planner placed or dragged count, so regenerating replaces the shaping points
 * it produced itself while keeping the ones that were chosen deliberately.
 */
export function loopAnchors(points: Waypoint[]): Coordinate[] {
  return points.filter((point) => point.role === 'via').map((point) => point.coordinate);
}

/**
 * What a point is called, wherever it is named. The map's popup and the sheet's
 * list read from this so a point does not go by two names.
 */
export function waypointLabel(
  mode: PlannerState['plan']['mode'],
  role: WaypointRole,
  index: number,
): string {
  // A loop's closing point sits on its start, so it goes by the same name.
  if (mode === 'loop')
    return index === 0 || role === 'destination' ? 'Start & finish' : `Loop point ${index}`;
  if (role === 'start') return 'Start';
  if (role === 'destination') return 'Finish';
  return `Via point ${index}`;
}

/**
 * What a point is marked with on the map and in the list. It matches the number
 * in the point's name, so a pin reading 2 is never the point called "point 1".
 */
export function waypointMarker(role: WaypointRole, index: number): string {
  if (role === 'start') return 'A';
  if (role === 'destination') return 'B';
  return String(index);
}
