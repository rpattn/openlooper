import type { Coordinate, PlannerState, Waypoint } from './models';

/**
 * The points the planner may reorder or remove. A generated loop also carries
 * shaping points and a closing destination, which exist to steer the router
 * rather than to be edited, so a loop exposes only its start and the points
 * placed by hand.
 */
export function editableWaypoints(state: PlannerState): Waypoint[] {
  if (state.plan.mode !== 'loop') return state.plan.waypoints;
  return state.plan.waypoints.filter(
    (point) => point.role === 'start' || point.role === 'via',
  );
}

/** Coordinates a generated loop has to pass through, in the planner's order. */
export function loopAnchors(points: Waypoint[]): Coordinate[] {
  return points.filter((point) => point.role === 'via').map((point) => point.coordinate);
}
