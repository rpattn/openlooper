import type {
  Activity,
  Coordinate,
  CreationMode,
  InteractionMode,
  MapStyleId,
  PlannerState,
  PlanSnapshot,
  RouteOverlay,
  RouteAlternative,
  RoutePlan,
  RouteResult,
  RoutingPreferences,
  SheetState,
  Waypoint,
} from "../domain/models";
import {
  DEFAULT_CAMERA,
  DEFAULT_MAP_STYLE,
  DEFAULT_OVERLAY,
  DEFAULT_PREFERENCES,
} from "../domain/models";

export const initialState: PlannerState = {
  camera: DEFAULT_CAMERA,
  mapStyle: DEFAULT_MAP_STYLE,
  overlay: DEFAULT_OVERLAY,
  interaction: "edit",
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
  sketchCompleted: false,
  loopTuned: false,
  past: [],
  future: [],
};

/** How many edits can be stepped back through. Deep enough to cover a stretch of
 * tuning, shallow enough that the stack stays small. */
const HISTORY_LIMIT = 30;

/** The part of the state an undo step puts back. */
export function planSnapshot(state: PlannerState): PlanSnapshot {
  return {
    plan: state.plan,
    sketchCompleted: state.sketchCompleted,
    loopTuned: state.loopTuned,
    activeTool: state.activeTool,
  };
}

/**
 * Marks a state change as one edit, so it can be stepped back from. Taking a new
 * step clears anything that was stepped back from: the route has branched away
 * from it and redoing onto this shape would produce a plan that never existed.
 */
function recorded(previous: PlannerState, next: PlannerState): PlannerState {
  return {
    ...next,
    past: [...previous.past, planSnapshot(previous)].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/** Puts a snapshot back, dropping the readings that belong to the route it
 * replaces. The route itself is recalculated by the planner. */
function applySnapshot(state: PlannerState, snapshot: PlanSnapshot): PlannerState {
  return {
    ...state,
    plan: snapshot.plan,
    sketchCompleted: snapshot.sketchCompleted,
    loopTuned: snapshot.loopTuned,
    activeTool: snapshot.activeTool,
    error: undefined,
    highlightedIssueId: undefined,
    highlightedEdgeIndex: undefined,
    profilePoint: undefined,
    profileKm: undefined,
  };
}

export type Action =
  | { type: "restore"; state: PlannerState }
  | { type: "camera"; center: Coordinate; zoom: number }
  | { type: "mapStyle"; style: MapStyleId }
  | { type: "overlay"; overlay: RouteOverlay }
  | { type: "interaction"; interaction: InteractionMode }
  | { type: "loopTuned"; tuned: boolean }
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
  | {
      type: "alternatives";
      alternatives: RouteAlternative[];
      preserveSelection?: boolean;
    }
  | { type: "routeError"; error: string }
  | { type: "selectRoute"; route: RouteResult }
  | { type: "tool"; tool: PlannerState["activeTool"] }
  | { type: "highlightIssue"; id?: string }
  | { type: "highlightEdge"; index?: number }
  | { type: "profilePoint"; coordinate?: Coordinate; distanceKm?: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "sheet"; sheet: SheetState }
  | { type: "loopSeed" }
  | { type: "finishSketch" }
  | { type: "clear" };

export function reducer(state: PlannerState, action: Action): PlannerState {
  switch (action.type) {
    case "restore":
      return action.state;
    case "camera":
      return { ...state, camera: { center: action.center, zoom: action.zoom } };
    case "mapStyle":
      return { ...state, mapStyle: action.style };
    case "overlay":
      return { ...state, overlay: action.overlay };
    case "interaction":
      return {
        ...state,
        interaction: action.interaction,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
    case "loopTuned":
      return { ...state, loopTuned: action.tuned };
    case "mode":
      return recorded(state, {
        ...state,
        plan: { ...state.plan, mode: action.mode, waypoints: [] },
        selectedRoute: undefined,
        alternatives: [],
        error: undefined,
        activeTool: "start",
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
        sketchCompleted: false,
        loopTuned: false,
      });
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
      // Every edit to the route — a tap, a drag, a reorder, a generated shape —
      // arrives here, so this is the one place a step back has to be recorded.
      return recorded(state, {
        ...state,
        plan: { ...state.plan, waypoints: action.waypoints },
        error: undefined,
      });
    case "routeStart":
      return {
        ...state,
        loading: true,
        progress: action.progress,
        error: undefined,
        // A cursor placed on the old route points at a distance the new one has
        // not got, so it goes rather than lingering over stale geometry.
        profilePoint: undefined,
        profileKm: undefined,
        previousDistanceKm: state.selectedRoute?.distanceKm,
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
      {
        const selected = action.preserveSelection
          ? action.alternatives.find(
              (item) => item.result.id === state.selectedRoute?.id,
            )?.result
          : undefined;
      return {
        ...state,
        loading: false,
        progress: undefined,
        error: undefined,
        alternatives: action.alternatives,
        selectedRoute: selected ?? action.alternatives[0]?.result,
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
      };
      }
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
      return {
        ...state,
        profilePoint: action.coordinate,
        profileKm: action.coordinate ? action.distanceKm : undefined,
      };
    case "undo": {
      const snapshot = state.past.at(-1);
      if (!snapshot) return state;
      return {
        ...applySnapshot(state, snapshot),
        past: state.past.slice(0, -1),
        future: [planSnapshot(state), ...state.future].slice(0, HISTORY_LIMIT),
      };
    }
    case "redo": {
      const snapshot = state.future[0];
      if (!snapshot) return state;
      return {
        ...applySnapshot(state, snapshot),
        past: [...state.past, planSnapshot(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
      };
    }
    case "sheet":
      return { ...state, sheet: action.sheet };
    case "loopSeed":
      return { ...state, loopSeed: state.loopSeed + 17 };
    case "finishSketch":
      return { ...state, sketchCompleted: true, activeTool: "add" };
    case "clear":
      return recorded(state, {
        ...state,
        plan: { ...state.plan, waypoints: [] },
        selectedRoute: undefined,
        alternatives: [],
        error: undefined,
        activeTool: "start",
        highlightedIssueId: undefined,
        highlightedEdgeIndex: undefined,
        profilePoint: undefined,
        profileKm: undefined,
        sketchCompleted: false,
        loopTuned: false,
      });
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
