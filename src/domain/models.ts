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
export type ViewportEvidenceState = {
  loading: boolean;
  error?: string;
  count: number;
};
export type SheetState = "collapsed" | "half" | "full";
export type PlannerState = {
  camera: MapCamera;
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
  sheet: SheetState;
  loopSeed: number;
  sketchCompleted: boolean;
};

export const DEFAULT_PREFERENCES: RoutingPreferences = {
  pathPreference: 0.65,
  avoidSteps: false,
  hillPreference: 0.5,
  roadComfort: 0.75,
  pavedPreference: true,
};
export const DEFAULT_CAMERA: MapCamera = {
  center: { lat: 52.8067, lon: -1.6432 },
  zoom: 12.5,
};

export function waypoint(coordinate: Coordinate, role: WaypointRole): Waypoint {
  return { id: crypto.randomUUID(), coordinate, role };
}
