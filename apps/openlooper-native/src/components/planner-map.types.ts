import type {
  Activity,
  Coordinate,
  MapCamera,
  RouteAlternative,
  RouteIssue,
  RouteResult,
  Waypoint,
} from '@/domain/models';

export type PlannerMapProps = {
  activity: Activity;
  activeTool: 'start' | 'destination' | 'add';
  camera: MapCamera;
  waypoints: Waypoint[];
  route?: RouteResult;
  fitRequest: number;
  alternatives: RouteAlternative[];
  highlightedIssue?: RouteIssue;
  profilePoint?: Coordinate;
  onMapPress: (coordinate: Coordinate) => void;
  onWaypointPress: (id: string) => void;
  onWaypointMove: (id: string, coordinate: Coordinate) => void;
  onIssuePress: (id: string) => void;
  onEdgePress: (index: number) => void;
  onAlternativePress: (id: string) => void;
  onCameraChange: (center: Coordinate, zoom: number) => void;
};
