import type {
  ActiveTool,
  Activity,
  Coordinate,
  CreationMode,
  PlannerState,
  Waypoint,
  WaypointRole,
} from '@/domain/models';

export const initialPlannerState: PlannerState = {
  activity: 'run',
  mode: 'pointToPoint',
  activeTool: 'start',
  waypoints: [],
  targetDistanceKm: 10,
  sketchCompleted: false,
  camera: {
    center: { lat: 52.8067, lon: -1.6432 },
    latitudeDelta: 0.1,
    longitudeDelta: 0.12,
  },
};

export type PlannerAction =
  | { type: 'activity'; activity: Activity }
  | { type: 'mode'; mode: CreationMode }
  | { type: 'tool'; tool: ActiveTool }
  | { type: 'target'; distanceKm: number }
  | { type: 'clear' }
  | { type: 'replace'; state: PlannerState };

export function plannerReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'activity':
      return { ...state, activity: action.activity };
    case 'mode':
      return {
        ...state,
        mode: action.mode,
        activeTool: 'start',
        waypoints: [],
        sketchCompleted: false,
      };
    case 'tool':
      return { ...state, activeTool: action.tool };
    case 'target':
      return {
        ...state,
        targetDistanceKm: Math.max(1, Math.min(100, action.distanceKm || 1)),
      };
    case 'clear':
      return {
        ...state,
        activeTool: 'start',
        waypoints: [],
        sketchCompleted: false,
      };
    case 'replace':
      return action.state;
  }
}

function waypoint(coordinate: Coordinate, role: WaypointRole): Waypoint {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    coordinate,
    role,
  };
}

function normalize(points: Waypoint[]): Waypoint[] {
  return points.map((point, index) => ({
    ...point,
    role:
      index === 0 ? 'start' : index === points.length - 1 ? 'destination' : 'via',
  }));
}

export function updatePlanFromMapPress(
  state: PlannerState,
  coordinate: Coordinate,
): PlannerState {
  if (state.mode === 'loop') {
    return { ...state, waypoints: [waypoint(coordinate, 'start')] };
  }

  if (state.mode === 'sketch') {
    if (state.sketchCompleted) return state;
    return {
      ...state,
      waypoints: normalize([...state.waypoints, waypoint(coordinate, 'destination')]),
    };
  }

  if (state.activeTool === 'start') {
    const next = state.waypoints.length
      ? [waypoint(coordinate, 'start'), ...state.waypoints.slice(1)]
      : [waypoint(coordinate, 'start')];
    return {
      ...state,
      activeTool: 'destination',
      waypoints: normalize(next),
    };
  }

  if (state.activeTool === 'destination') {
    const next =
      state.waypoints.length > 1
        ? [...state.waypoints.slice(0, -1), waypoint(coordinate, 'destination')]
        : [...state.waypoints, waypoint(coordinate, 'destination')];
    return { ...state, waypoints: normalize(next) };
  }

  return {
    ...state,
    waypoints: normalize([...state.waypoints, waypoint(coordinate, 'via')]),
  };
}

function hasTwoDistinctPoints(points: Waypoint[]): boolean {
  const first = points[0]?.coordinate;
  return Boolean(
    first &&
      points.some(
        ({ coordinate }) =>
          Math.hypot(coordinate.lat - first.lat, coordinate.lon - first.lon) > 0.00001,
      ),
  );
}

export function selectWaypoint(state: PlannerState, id: string): PlannerState {
  if (
    state.mode !== 'sketch' ||
    state.sketchCompleted ||
    !hasTwoDistinctPoints(state.waypoints)
  )
    return state;

  const first = state.waypoints[0];
  const last = state.waypoints.at(-1);
  if (!first || !last) return state;

  if (id === last.id) return { ...state, sketchCompleted: true, activeTool: 'add' };
  if (id !== first.id) return state;

  return {
    ...state,
    sketchCompleted: true,
    activeTool: 'add',
    waypoints: normalize([...state.waypoints, waypoint(first.coordinate, 'destination')]),
  };
}
