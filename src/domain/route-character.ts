import type { Activity, IssueCategory, RouteIssue } from "./models";

/**
 * What a route is made of, per activity, expressed over the evidence sources
 * the preparation build records.
 *
 * Each weight is applied to the share of route distance that source covers.
 * Positive weights say "more of this makes the route worth taking"; negative
 * weights say the opposite. Nothing here is a safety claim — a source records
 * what was mapped or recorded, never that a route is safe.
 *
 * `gps_unclassified_2013` is deliberately absent. It holds 83% of the archive's
 * accepted coordinates, because roughly two thirds of uploaded traces are
 * anonymised by OSM and carry no usable timing, and it covers 82% of
 * residential and 67% of trunk road against 36% of footway. It measures where
 * the road network is, not whether a route is good. It stays in the database
 * for the map overlay and out of the ranking.
 *
 * `gps_vehicle_2013` is used as a negative rather than discarded: it is the one
 * mode class that separates cleanly (19% of trunk and 21% of secondary against
 * 0% of footway, path and track), which makes it a measured stand-in for "cars
 * actually drive here" that `road_class` alone cannot give.
 */
export const CHARACTER_WEIGHTS: Record<Activity, Record<string, number>> = {
  run: {
    row_footpath: 0.9,
    row_bridleway: 0.7,
    row_byway: 0.4,
    near_green: 0.8,
    near_water: 0.5,
    osm_network_walking_major: 0.5,
    osm_route_walking: 0.3,
    osm_route_running: 0.6,
    gps_foot_2013: 0.4,
    gps_vehicle_2013: -1.0,
    speed_limit_high: -0.8,
  },
  walk: {
    row_footpath: 1.0,
    row_bridleway: 0.8,
    row_byway: 0.5,
    near_green: 0.8,
    near_water: 0.6,
    osm_network_walking_major: 0.6,
    osm_route_walking: 0.4,
    gps_foot_2013: 0.4,
    gps_vehicle_2013: -1.0,
    speed_limit_high: -0.9,
  },
  cycle: {
    osm_network_cycling_major: 1.0,
    osm_route_cycling: 0.6,
    gps_cycle_2013: 0.5,
    near_green: 0.4,
    near_water: 0.3,
    row_bridleway: 0.3,
    row_byway: 0.3,
    gps_vehicle_2013: -0.5,
    speed_limit_high: -0.9,
    speed_limit_low: 0.3,
  },
};

/**
 * Divides the weighted sum so real candidates spread across the range instead of
 * clustering near zero. No route carries every positive source at once, so
 * scaling by the full positive total would leave the term doing almost nothing.
 *
 * Calibrated on 48 generated candidates per activity across four starts around
 * Burton upon Trent. At this value a 10 km run spans about -0.33 to +0.61 and a
 * 30 km cycle about -0.49 to +0.99, with nothing clipped at either end — so the
 * term can reorder candidates without saturating and losing the difference
 * between two good ones.
 */
const CHARACTER_SCALE = 0.25;

export function characterScale(activity: Activity): number {
  const weights = CHARACTER_WEIGHTS[activity];
  const positive = Object.values(weights).reduce(
    (total, weight) => total + Math.max(0, weight),
    0,
  );
  return positive * CHARACTER_SCALE;
}

/**
 * How much this route looks like one worth taking, from -1 to 1, or `undefined`
 * when there is no evidence breakdown to read. Undefined stays neutral: absent
 * evidence is unknown, never a penalty.
 */
export function characterScore(
  activity: Activity,
  bySource?: Record<string, number>,
): number | undefined {
  if (!bySource) return undefined;
  const weights = CHARACTER_WEIGHTS[activity];
  let total = 0;
  for (const [source, weight] of Object.entries(weights))
    total += (bySource[source] ?? 0) * weight;
  const scaled = total / characterScale(activity);
  return Math.max(-1, Math.min(1, scaled));
}

/** The sources that moved this route's character score, largest effect first. */
export function characterContributions(
  activity: Activity,
  bySource?: Record<string, number>,
): Array<{ source: string; share: number; points: number }> {
  if (!bySource) return [];
  const weights = CHARACTER_WEIGHTS[activity];
  return Object.entries(weights)
    .map(([source, weight]) => ({
      source,
      share: bySource[source] ?? 0,
      points: (bySource[source] ?? 0) * weight,
    }))
    .filter((entry) => Math.abs(entry.points) > 0.001)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
}

/**
 * What one kilometre of each kind of issue costs, per activity, replacing a
 * single severity-based multiplier that charged a gravel path the same as a
 * trunk road.
 *
 * The headline correction is `surface`: an unpaved or gravel section is close
 * to neutral on foot and often the reason for the route, while it stays a real
 * cost on a bike. Steps run the other way — a nuisance on foot, a dismount on a
 * bike. Categories whose confidence is `unknown` never score at all, so their
 * weight here is zero and stays zero.
 */
export const ISSUE_WEIGHTS: Record<Activity, Record<IssueCategory, number>> = {
  run: {
    steps: 0.5,
    majorRoad: 2.0,
    surface: 0.15,
    steep: 0.6,
    footwayEnds: 0.5,
    gradientUnknown: 0,
    sidewalkUnknown: 0,
    cycleInfraUnknown: 0,
    surfaceUnknown: 0,
  },
  walk: {
    steps: 0.3,
    majorRoad: 2.2,
    surface: 0.05,
    steep: 0.3,
    footwayEnds: 0.6,
    gradientUnknown: 0,
    sidewalkUnknown: 0,
    cycleInfraUnknown: 0,
    surfaceUnknown: 0,
  },
  cycle: {
    steps: 3.0,
    majorRoad: 1.2,
    surface: 1.0,
    steep: 1.0,
    footwayEnds: 0.3,
    gradientUnknown: 0,
    sidewalkUnknown: 0,
    cycleInfraUnknown: 0,
    surfaceUnknown: 0,
  },
};

/** Weighted issue kilometres for one activity. Unknown confidence never counts. */
export function issueKilometres(issues: RouteIssue[], activity: Activity): number {
  const weights = ISSUE_WEIGHTS[activity];
  return issues.reduce(
    (total, issue) =>
      total +
      (issue.confidence === "unknown"
        ? 0
        : issue.lengthKm * (weights[issue.category] ?? 1)),
    0,
  );
}

/**
 * How much of the character term survives the route's blocking problems, from
 * 0 to 1. Scales with the affected distance rather than switching off entirely,
 * so twenty metres of steps no longer wipes out the whole term the way a
 * Boolean `issues.some(high)` gate did.
 */
export function blockingFactor(
  issues: RouteIssue[],
  routeDistanceKm: number,
): number {
  const blockingKm = issues
    .filter(
      (issue) => issue.severity === "high" && issue.confidence !== "unknown",
    )
    .reduce((total, issue) => total + issue.lengthKm, 0);
  const tolerance = Math.max(0.25, routeDistanceKm * 0.05);
  return Math.max(0, 1 - blockingKm / tolerance);
}
