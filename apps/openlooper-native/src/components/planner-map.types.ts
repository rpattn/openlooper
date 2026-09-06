import type { OverlayBand } from '../../../../src/domain/route-overlays';
import type {
  Coordinate,
  CreationMode,
  InteractionMode,
  MapCamera,
  MapStyleId,
  RouteAlternative,
  RouteIssue,
  RouteResult,
  Waypoint,
} from '@/domain/models';

export type PlannerMapProps = {
  activeTool: 'start' | 'destination' | 'add';
  /** `inspect` never edits the route, so taps only read from it. */
  interaction: InteractionMode;
  /** Coloured spans of the selected route, from the chosen colouring. */
  bands: OverlayBand[];
  /** Issue spans are only drawn over the plain route colouring. */
  showIssues: boolean;
  camera: MapCamera;
  mapStyle: MapStyleId;
  /** Height of the sheet, so route fitting keeps the route above it. */
  bottomInset: number;
  waypoints: Waypoint[];
  /** Names the points the same way the sheet's list does. */
  mode: CreationMode;
  /** False once the home page has covered the map, so the map stops rendering
   * chrome — an open marker popup otherwise outlives the screen it belongs to. */
  active: boolean;
  route?: RouteResult;
  fitRequest: number;
  alternatives: RouteAlternative[];
  highlightedIssue?: RouteIssue;
  profilePoint?: Coordinate;
  onMapPress: (coordinate: Coordinate) => void;
  onWaypointPress: (id: string) => void;
  /** Removes a point from the popup its marker opens. */
  onWaypointDelete: (id: string) => void;
  onWaypointMove: (id: string, coordinate: Coordinate) => void;
  onIssuePress: (id: string) => void;
  onEdgePress: (index: number) => void;
  onAlternativePress: (id: string) => void;
  onCameraChange: (center: Coordinate, zoom: number) => void;
};
