import { randomId } from '../../../../src/domain/id';
import { ACTIVITY } from './models';
import type {
  Activity,
  Coordinate,
  CreationMode,
  RoutePlan,
  RouteResult,
} from './models';

/** How many points a card outline keeps. Enough to read the shape of a loop at
 * thumbnail size without storing the whole route line twice. */
const OUTLINE_POINTS = 56;

/** What the saved-route list needs to draw a card. Held apart from the route
 * payload so a page of cards never loads the full geometry it belongs to. */
export type SavedRouteSummary = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  activity: Activity;
  mode: CreationMode;
  distanceKm: number;
  durationSeconds: number;
  ascentM?: number;
  descentM?: number;
  outline: Coordinate[];
};

/** A summary together with everything the planner needs to reopen the route. */
export type SavedRoute = SavedRouteSummary & { plan: RoutePlan; route: RouteResult };

export type SavedRoutePage = {
  items: SavedRouteSummary[];
  /** Every saved route, not just this page, so the pager can size itself. */
  total: number;
  totalDistanceKm: number;
};

/** Evenly spaced sample of a route line, keeping both ends. */
export function routeOutline(geometry: Coordinate[], count = OUTLINE_POINTS): Coordinate[] {
  if (geometry.length <= count) return geometry;
  const step = (geometry.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => geometry[Math.round(index * step)]!);
}

/**
 * Trims a route down to what is worth keeping on disk. Segment attributes and
 * the notes derived from them are re-fetched when the route is reopened, the
 * same way a freshly chosen alternative is, and evidence geometry is only ever
 * needed while the route is on screen.
 */
export function storableRoute(route: RouteResult): RouteResult {
  return {
    ...route,
    edges: [],
    issues: [],
    useEvidence: route.useEvidence && { ...route.useEvidence, segments: undefined },
  };
}

const MODE_WORD: Record<CreationMode, string> = {
  pointToPoint: 'route',
  loop: 'loop',
  sketch: 'sketch',
};

/** Starting point for the name field, which the planner then edits. */
export function suggestedName(plan: RoutePlan, route: RouteResult): string {
  return `${route.distanceKm.toFixed(1)} km ${ACTIVITY[plan.activity].label.toLowerCase()} ${MODE_WORD[plan.mode]}`;
}

export function savedRoute(
  name: string,
  plan: RoutePlan,
  route: RouteResult,
  existing?: Pick<SavedRouteSummary, 'id' | 'createdAt'>,
): SavedRoute {
  const now = Date.now();
  const stored = storableRoute(route);
  return {
    id: existing?.id ?? randomId(),
    name: name.trim() || suggestedName(plan, route),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    activity: plan.activity,
    mode: plan.mode,
    distanceKm: route.distanceKm,
    durationSeconds: route.durationSeconds,
    ascentM: route.ascentM,
    descentM: route.descentM,
    outline: routeOutline(route.geometry),
    plan,
    route: stored,
  };
}

export function summaryOf(route: SavedRoute): SavedRouteSummary {
  return {
    id: route.id,
    name: route.name,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
    activity: route.activity,
    mode: route.mode,
    distanceKm: route.distanceKm,
    durationSeconds: route.durationSeconds,
    ascentM: route.ascentM,
    descentM: route.descentM,
    outline: route.outline,
  };
}
