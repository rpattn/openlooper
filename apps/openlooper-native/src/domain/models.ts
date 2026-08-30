export type Coordinate = { lat: number; lon: number };
export type Activity = 'run' | 'walk' | 'cycle';
export type CreationMode = 'pointToPoint' | 'loop' | 'sketch';
export type ActiveTool = 'start' | 'destination' | 'add';
export type WaypointRole = 'start' | 'via' | 'destination';

export type Waypoint = {
  id: string;
  coordinate: Coordinate;
  role: WaypointRole;
};

export type MapCamera = {
  center: Coordinate;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type PlannerState = {
  activity: Activity;
  mode: CreationMode;
  activeTool: ActiveTool;
  waypoints: Waypoint[];
  targetDistanceKm: number;
  sketchCompleted: boolean;
  camera: MapCamera;
};

export const ACTIVITY = {
  run: { label: 'Run', color: '#e85d3f' },
  walk: { label: 'Walk', color: '#247d60' },
  cycle: { label: 'Cycle', color: '#3166c7' },
} as const;

export const CREATION_MODES: Array<{ value: CreationMode; label: string }> = [
  { value: 'pointToPoint', label: 'A → B' },
  { value: 'loop', label: 'Loop' },
  { value: 'sketch', label: 'Sketch' },
];
