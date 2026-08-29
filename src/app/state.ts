import type {
  Activity,
  Coordinate,
  CreationMode,
  PlannerState,
  RouteAlternative,
  RoutePlan,
  RouteResult,
  RoutingPreferences,
  SheetState,
  Waypoint,
} from "../domain/models";
import { DEFAULT_CAMERA, DEFAULT_PREFERENCES } from "../domain/models";

export const initialState: PlannerState = {
  camera: DEFAULT_CAMERA,
  plan: {
    mode: "pointToPoint",
    activity: "run",
    waypoints: [],
    preferences: DEFAULT_PREFERENCES,
  },
  alternatives: [],
  loading: false,
  activeTool: "start",
  sheet: "half",
  loopSeed: 0,
};

export type Action =
  | { type: "restore"; state: PlannerState }
  | { type: "camera"; center: Coordinate; zoom: number }
  | { type: "mode"; mode: CreationMode }
  | { type: "activity"; activity: Activity }
  | { type: "preferences"; preferences: RoutingPreferences }
  | { type: "target"; distanceKm: number }
  | { type: "waypoints"; waypoints: Waypoint[] }
  | { type: "routeStart"; progress?: string }
  | { type: "progress"; progress: string }
  | {
      type: "routeSuccess";
      route: RouteResult;
      alternatives: RouteAlternative[];
    }
  | { type: "alternatives"; alternatives: RouteAlternative[] }
  | { type: "routeError"; error: string }
  | { type: "selectRoute"; route: RouteResult }
  | { type: "tool"; tool: PlannerState["activeTool"] }
  | { type: "highlightIssue"; id?: string }
  | { type: "highlightEdge"; index?: number }
  | { type: "profilePoint"; coordinate?: Coordinate }
  | { type: "sheet"; sheet: SheetState }
  | { type: "loopSeed" }
  | { type: "clear" };

export function reducer(state: PlannerState, action: Action): PlannerState {
  switch (action.type) {
    case "restore":
      return action.state;
    case "camera":
      return { ...state, camera: { center: action.center, zoom: action.zoom } };
    case "mode":
      return {
        ...state,
        plan: { ...state.plan, mode: action.mode, waypoints: [] },
        selectedRoute: undefined,
        alternatives: [],
        error: undefined,
        activeTool: "start",
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
    case "activity":
      return {
        ...state,
        plan: { ...state.plan, activity: action.activity },
        error: undefined,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
        selectedRoute: state.selectedRoute
          ? { ...state.selectedRoute, issues: [], edges: [] }
          : undefined,
      };
    case "preferences":
      return {
        ...state,
        plan: { ...state.plan, preferences: action.preferences },
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
        selectedRoute: state.selectedRoute
          ? { ...state.selectedRoute, issues: [], edges: [] }
          : undefined,
      };
    case "target":
      return {
        ...state,
        plan: {
          ...state.plan,
          targetDistanceKm: Math.max(1, Math.min(100, action.distanceKm || 1)),
        },
      };
    case "waypoints":
      return {
        ...state,
        plan: { ...state.plan, waypoints: action.waypoints },
        error: undefined,
      };
    case "routeStart":
      return {
        ...state,
        loading: true,
        progress: action.progress,
        error: undefined,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
        selectedRoute: state.selectedRoute
          ? { ...state.selectedRoute, issues: [], edges: [] }
          : undefined,
      };
    case "progress":
      return { ...state, progress: action.progress };
    case "routeSuccess":
      return {
        ...state,
        loading: false,
        progress: undefined,
        error: undefined,
        selectedRoute: action.route,
        alternatives: action.alternatives,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
    case "alternatives":
      return {
        ...state,
        loading: false,
        progress: undefined,
        error: undefined,
        alternatives: action.alternatives,
        selectedRoute: action.alternatives[0]?.result,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
    case "routeError":
      return {
        ...state,
        loading: false,
        progress: undefined,
        error: action.error,
      };
    case "selectRoute":
      return {
        ...state,
        selectedRoute: action.route,
        error: undefined,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
    case "tool":
      return { ...state, activeTool: action.tool };
    case "highlightIssue":
      return {
        ...state,
        highlightedIssueId: action.id,
        highlightedEdgeIndex: undefined,
      };
    case "highlightEdge":
      return {
        ...state,
        highlightedEdgeIndex: action.index,
        highlightedIssueId: undefined,
      };
    case "profilePoint":
      return { ...state, profilePoint: action.coordinate };
    case "sheet":
      return { ...state, sheet: action.sheet };
    case "loopSeed":
      return { ...state, loopSeed: state.loopSeed + 17 };
    case "clear":
      return {
        ...state,
        plan: { ...state.plan, waypoints: [] },
        selectedRoute: undefined,
        alternatives: [],
        error: undefined,
        activeTool: "start",
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
  }
}

export function normalizedWaypoints(points: Waypoint[]): Waypoint[] {
  return points.map((point, index) => ({
    ...point,
    role:
      index === 0
        ? "start"
        : index === points.length - 1
          ? "destination"
          : point.role === "generated"
            ? "generated"
            : "via",
  }));
}
export function routePlan(
  state: PlannerState,
  waypoints = state.plan.waypoints,
): RoutePlan {
  return { ...state.plan, waypoints: normalizedWaypoints(waypoints) };
}
