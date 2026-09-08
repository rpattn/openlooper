import { randomId } from "./id";

export type Coordinate = { lat: number; lon: number };
export type Activity = "run" | "walk" | "cycle";
export type CreationMode = "pointToPoint" | "loop" | "sketch";
export type WaypointRole = "start" | "via" | "destination" | "generated";
export type Waypoint = {
  id: string;
  coordinate: Coordinate;
  role: WaypointRole;
};

/** What the planner is willing to travel on. */
export type SurfaceTolerance = "paved" | "firm" | "any";
export type RoutingPreferences = {
  /**
   * 0 keeps the route direct and on made-up surfaces; 1 pushes it onto paths
   * and away from main roads. One control rather than four, because the four it
   * replaces interacted in ways nobody could predict. Measured end to end on
   * pedestrian costing, this moves a route from 12% path and 53% main road to
   * 60% path and 13%.
   */
  character: number;
  surfaceTolerance: SurfaceTolerance;
  hillPreference: number;
  /** A hard avoid, kept apart from the soft preferences above it. */
  avoidSteps: boolean;
  /**
   * Walking and running only. Lit ways are mostly main roads, so this both
   * lengthens the route and puts more of it on traffic — measured at +3.8 km
   * and 65% main road against 16% without it.
   */
  preferLit: boolean;
};

export type RoutePlan = {
  mode: CreationMode;
  activity: Activity;
  waypoints: Waypoint[];
  preferences: RoutingPreferences;
  targetDistanceKm?: number;
};

export type ElevationPoint = {
  distanceKm: number;
  elevationM: number;
  coordinate: Coordinate;
};
export type RouteLeg = {
  beginIndex: number;
  endIndex: number;
  distanceKm: number;
  durationSeconds: number;
};
export type RouteEdge = {
  beginIndex: number;
  endIndex: number;
  lengthKm: number;
  attributes: EdgeAttributes;
};
export type RouteUseEvidence = {
  status: "available" | "unavailable";
  evidencedDistanceKm: number;
  evidencedDistancePct: number;
  /**
   * Share of route distance covered by each evidence source, 0 to 1. Present
   * only when a breakdown was requested. Sources are summed per section rather
   * than unioned, so a value can sit slightly above the union share; it drives
   * ranking, not the headline `evidencedDistancePct`.
   */
  bySource?: Record<string, number>;
  segments?: GeoJSON.FeatureCollection;
};
export type EdgeAttributes = {
  name?: string;
  roadClass?: string;
  use?: string;
  surface?: string;
  travelMode?: string;
  travelType?: string;
  unpaved?: boolean;
  sidewalk?: string;
  cycleLane?: string;
  shoulder?: boolean;
  laneCount?: number;
  bicycleNetwork?: number;
  maxUpwardGrade?: number;
  maxDownwardGrade?: number;
  /** Valhalla's predicted travel speed for the edge, in km/h. */
  speedKph?: number;
  wayId?: number;
};
export type IssueCategory =
  | "steps"
  | "majorRoad"
  | "surface"
  | "steep"
  | "footwayEnds"
  | "gradientUnknown"
  | "sidewalkUnknown"
  | "cycleInfraUnknown"
  | "surfaceUnknown";
export type RouteIssue = {
  id: string;
  category: IssueCategory;
  severity: "info" | "warning" | "high";
  confidence: "observed" | "potential" | "unknown";
  title: string;
  explanation: string;
  beginIndex: number;
  endIndex: number;
  lengthKm: number;
  geometry: Coordinate[];
  attributes: EdgeAttributes;
};
export type RouteResult = {
  id: string;
  geometry: Coordinate[];
  legs: RouteLeg[];
  distanceKm: number;
  durationSeconds: number;
  ascentM?: number;
  descentM?: number;
  elevation: ElevationPoint[];
  bounds: [Coordinate, Coordinate];
  issues: RouteIssue[];
  edges: RouteEdge[];
  useEvidence?: RouteUseEvidence;
  encodedShape?: string;
  label?: string;
};
export type LoopScoringWeights = {
  distance: number;
  repetition: number;
  geometry: number;
  issues: number;
  /**
   * Points available to the character term, which is the only part of the score
   * a route can gain rather than only lose. It runs from -1 to 1, so a route
   * made of main road can spend these points as well as earn them.
   */
  character: number;
};
export type LoopMetrics = {
  distanceError: number;
  repeatedCoverage: number;
  compactnessPenalty: number;
  earlyReturnPenalty: number;
  issuePenalty: number;
  distancePenaltyPoints: number;
  repetitionPenaltyPoints: number;
  geometryPenaltyPoints: number;
  issuePenaltyPoints: number;
  /** -1 to 1, or undefined when there is no evidence breakdown to read. */
  character?: number;
  characterPoints: number;
  baseScore: number;
  score: number;
};
export type RouteAlternative = {
  id: string;
  result: RouteResult;
  metrics?: LoopMetrics;
  label: string;
  waypoints?: Waypoint[];
};
export type MapCamera = { center: Coordinate; zoom: number };
/** Base map rendering. These map onto MapKit's map types on iOS and onto the
 * nearest vector or raster style on the web map. */
export type MapStyleId = "standard" | "muted" | "satellite" | "hybrid";
/** What the route line is coloured by while inspecting it. */
export type RouteOverlay =
  | "route"
  | "gradient"
  | "surface"
  | "roads"
  | "usage"
  | "speed";
/** `edit` lets map taps change the route; `inspect` only reads it. */
export type InteractionMode = "edit" | "inspect";
export type ViewportEvidenceState = {
  loading: boolean;
  error?: string;
  count: number;
};
export type SheetState = "collapsed" | "half" | "full";
/**
 * What one undo step restores: the shape of the route and the way it is being
 * edited. Route results are left out deliberately — the plan is the source of
 * truth, and stepping back reroutes through the points it restores.
 */
export type PlanSnapshot = {
  plan: RoutePlan;
  sketchCompleted: boolean;
  loopTuned: boolean;
  activeTool: PlannerState["activeTool"];
};
export type PlannerState = {
  camera: MapCamera;
  mapStyle: MapStyleId;
  overlay: RouteOverlay;
  interaction: InteractionMode;
  plan: RoutePlan;
  selectedRoute?: RouteResult;
  alternatives: RouteAlternative[];
  loading: boolean;
  progress?: string;
  error?: string;
  activeTool: "start" | "destination" | "add";
  highlightedIssueId?: string;
  highlightedEdgeIndex?: number;
  profilePoint?: Coordinate;
  /** How far along the route `profilePoint` sits, so the map and the profile
   * chart can each drive the other from one position. */
  profileKm?: number;
  /** The distance the route had when the edit in flight started, so the summary
   * can say what the edit changed rather than only what it produced. */
  previousDistanceKm?: number;
  sheet: SheetState;
  loopSeed: number;
  sketchCompleted: boolean;
  /** Set once the planner edits a generated loop by hand. From then on the loop
   * is rerouted through its current points rather than generated afresh, so a
   * preference change cannot throw away the shape being tuned. */
  loopTuned: boolean;
  /** Edits that can be stepped back to, oldest first, and the ones stepped back
   * from. Neither survives a reload: an undo into a route that is no longer on
   * screen restores something the planner never saw. */
  past: PlanSnapshot[];
  future: PlanSnapshot[];
};

export const DEFAULT_PREFERENCES: RoutingPreferences = {
  character: 0.65,
  surfaceTolerance: "firm",
  hillPreference: 0.5,
  avoidSteps: false,
  preferLit: false,
};
export const DEFAULT_MAP_STYLE: MapStyleId = "standard";
export const DEFAULT_OVERLAY: RouteOverlay = "route";
export const DEFAULT_CAMERA: MapCamera = {
  center: { lat: 52.8067, lon: -1.6432 },
  zoom: 12.5,
};

export function waypoint(coordinate: Coordinate, role: WaypointRole): Waypoint {
  return { id: randomId(), coordinate, role };
}

/**
 * Reads stored preferences, whatever shape they were saved in. A session saved
 * before the controls were reworked carries `pathPreference`, `roadComfort` and
 * `pavedPreference`; those map onto what replaced them, so an existing session
 * keeps the route it was planning rather than being reset to the defaults.
 */
export function normalizedPreferences(value: unknown): RoutingPreferences {
  if (typeof value !== "object" || value === null) return DEFAULT_PREFERENCES;
  const stored = value as Record<string, unknown>;
  const number = (input: unknown, fallback: number) =>
    typeof input === "number" && Number.isFinite(input)
      ? Math.min(1, Math.max(0, input))
      : fallback;
  const legacyCharacter =
    typeof stored.pathPreference === "number"
      ? stored.pathPreference
      : typeof stored.roadComfort === "number"
        ? stored.roadComfort
        : undefined;
  const tolerance = stored.surfaceTolerance;
  return {
    character: number(
      stored.character ?? legacyCharacter,
      DEFAULT_PREFERENCES.character,
    ),
    surfaceTolerance:
      tolerance === "paved" || tolerance === "firm" || tolerance === "any"
        ? tolerance
        : stored.pavedPreference === false
          ? "any"
          : DEFAULT_PREFERENCES.surfaceTolerance,
    hillPreference: number(
      stored.hillPreference,
      DEFAULT_PREFERENCES.hillPreference,
    ),
    avoidSteps: Boolean(stored.avoidSteps),
    preferLit: Boolean(stored.preferLit),
  };
}
