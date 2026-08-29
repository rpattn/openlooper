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

export function costingOptions(
  activity: Activity,
  preferences: RoutingPreferences,
): Record<string, unknown> {
  if (activity === "cycle")
    return {
      bicycle_type: preferences.pavedPreference ? "hybrid" : "cross",
      cycling_speed: ACTIVITY.cycle.speedKmh,
      use_roads: 1 - preferences.roadComfort,
      avoid_bad_surfaces: preferences.pavedPreference ? 0.8 : 0.25,
      use_hills: preferences.hillPreference,
    };
  return {
    walking_speed: ACTIVITY[activity].speedKmh,
    walkway_factor: 1.4 - preferences.pathPreference,
    sidewalk_factor: 1.4 - preferences.pathPreference,
    step_penalty: preferences.avoidSteps ? 3600 : 30,
    use_hills: preferences.hillPreference,
  };
}
