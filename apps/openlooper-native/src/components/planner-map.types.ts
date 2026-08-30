import type { Coordinate, MapCamera, Waypoint } from '@/domain/models';

export type PlannerMapProps = {
  camera: MapCamera;
  waypoints: Waypoint[];
  onMapPress: (coordinate: Coordinate) => void;
  onWaypointPress: (id: string) => void;
};
