import type { Activity, RoutingPreferences } from "./models";

export const ACTIVITY = {
  run: { label: "Run", speedKmh: 10, color: "#e85d3f", costing: "pedestrian" },
  walk: {
    label: "Walk",
    speedKmh: 5.1,
    color: "#247d60",
    costing: "pedestrian",
  },
  cycle: { label: "Cycle", speedKmh: 18, color: "#3166c7", costing: "bicycle" },
} as const;

/**
 * Maps the planner's preferences onto Valhalla costing options, using only
 * options measured to change a route on this graph. `max_hiking_difficulty`,
 * `alley_factor`, `driveway_factor` and `service_penalty` were all measured to
 * do nothing here — `sac_scale` is on 0.1% of local ways — so no control offers
 * them rather than offering a control that does nothing.
 */
export function costingOptions(
  activity: Activity,
  preferences: RoutingPreferences,
): Record<string, unknown> {
  const { character, surfaceTolerance, hillPreference, avoidSteps } = preferences;
  if (activity === "cycle")
    return {
      bicycle_type:
        surfaceTolerance === "paved"
          ? "road"
          : surfaceTolerance === "firm"
            ? "hybrid"
            : "cross",
      cycling_speed: ACTIVITY.cycle.speedKmh,
      // 1 sends the route down main roads, 0 keeps it off them: measured 39%
      // main road at 1.0 against 8% at 0.0.
      use_roads: Number((1 - character).toFixed(2)),
      avoid_bad_surfaces:
        surfaceTolerance === "paved" ? 1 : surfaceTolerance === "firm" ? 0.7 : 0.1,
      use_hills: hillPreference,
    };
  return {
    walking_speed: ACTIVITY[activity].speedKmh,
    // The master lever on foot: 1.4 leaves paths unattractive, 0.4 strongly
    // prefers them.
    walkway_factor: Number((1.4 - character).toFixed(2)),
    sidewalk_factor: Number((1.4 - character).toFixed(2)),
    // Tracks are the field-edge and forestry surface: worth 11 points of path
    // share between its ends.
    use_tracks:
      surfaceTolerance === "paved" ? 0 : surfaceTolerance === "firm" ? 0.5 : 1,
    step_penalty: avoidSteps ? 3600 : 30,
    ...(preferences.preferLit ? { use_lit: 1 } : {}),
    use_hills: hillPreference,
  };
}
