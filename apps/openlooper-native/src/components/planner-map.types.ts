import type { OverlayBand } from '../../../../src/domain/route-overlays';
import type { DistanceMarker } from '@/domain/distance-markers';
import type { Bounds } from '@/state/use-viewport-evidence';
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
  /** Width of the desktop panel, so route fitting keeps the route clear of it
   * too. Zero on the phone layout, where the sheet is below rather than beside. */
  leftInset: number;
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
  /** Whole kilometres drawn along the route, so distance can be read off the
   * line rather than only out of the summary. */
  markers: DistanceMarker[];
  /** Recorded use for the visible area, drawn under everything the planner
   * draws. Absent when the underlay is off or the service is unavailable. */
  evidenceSections?: GeoJSON.FeatureCollection;
  onMapPress: (coordinate: Coordinate) => void;
  onWaypointPress: (id: string) => void;
  /** Removes a point from the popup its marker opens. */
  onWaypointDelete: (id: string) => void;
  onWaypointMove: (id: string, coordinate: Coordinate) => void;
  onIssuePress: (id: string) => void;
  /** The exact point, where the platform can report one; the screen falls back
   * to the middle of the edge when it cannot. */
  onEdgePress: (index: number, coordinate?: Coordinate) => void;
  /** Reshapes the route: `from` is where the line was taken hold of, `to` is
   * where it was let go. */
  onRouteDrag: (from: Coordinate, to: Coordinate) => void;
  /** The visible extent, reported so the evidence underlay can follow the map. */
  onBoundsChange: (bounds: Bounds) => void;
  onAlternativePress: (id: string) => void;
  onCameraChange: (center: Coordinate, zoom: number) => void;
};
