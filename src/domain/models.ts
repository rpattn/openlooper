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

export type RoutingPreferences = {
  pathPreference: number;
  avoidSteps: boolean;
  hillPreference: number;
  roadComfort: number;
  pavedPreference: boolean;
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
  evidence: number;
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
  evidenceBonusPoints: number;
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
  pathPreference: 0.65,
  avoidSteps: false,
  hillPreference: 0.5,
  roadComfort: 0.75,
  pavedPreference: true,
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
