import { costingOptions } from '../../../../src/domain/activity-profiles';
import type { RoutePlan, RouteResult } from '../../../../src/domain/models';
import { encodePolyline, mapTrip } from '../../../../src/routing/valhalla-mapper';
import type {
  ValhallaRouteResponse,
  ValhallaTraceResponse,
} from '../../../../src/routing/valhalla-types';
import { VALHALLA_URL as BASE } from './endpoints';

const GENERATED_LOOP_RADIUS_M = 150;

class RoutingError extends Error {
  constructor(message: string, readonly errorCode?: number) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new Error('The routing service is unavailable. Your current route and map are still usable.');
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    error_code?: number;
  };
  if (!response.ok || data.error) {
    const outside = data.error_code === 171 || data.error_code === 442;
    throw new RoutingError(
      outside
        ? 'Routing data is not loaded for this area. You can still move the map and choose another location.'
        : data.error || `Routing failed (${response.status}).`,
      data.error_code,
    );
  }
  return data;
}

export async function requestRoute(
  plan: RoutePlan,
  signal?: AbortSignal,
  alternatives = true,
): Promise<RouteResult[]> {
  if (plan.waypoints.length < 2) return [];
  const data = await post<ValhallaRouteResponse>(
    '/route',
    {
      locations: plan.waypoints.map((point, index) => ({
        lat: point.coordinate.lat,
        lon: point.coordinate.lon,
        type: index === 0 || index === plan.waypoints.length - 1 ? 'break' : 'through',
        ...(point.role === 'generated'
          ? { radius: GENERATED_LOOP_RADIUS_M, rank_candidates: false }
          : {}),
      })),
      costing: plan.activity === 'cycle' ? 'bicycle' : 'pedestrian',
      costing_options: {
        [plan.activity === 'cycle' ? 'bicycle' : 'pedestrian']: costingOptions(
          plan.activity,
          plan.preferences,
        ),
      },
      units: 'kilometers',
      elevation_interval: 30,
      alternates: alternatives && plan.waypoints.length === 2 ? 2 : 0,
    },
    signal,
  );
  if (!data.trip) throw new Error('The routing service returned no route.');
  return [
    mapTrip(data.trip),
    ...(data.alternates ?? []).flatMap((item) => (item.trip ? [mapTrip(item.trip)] : [])),
  ];
}

export async function traceRoute(
  result: RouteResult,
  activity: RoutePlan['activity'],
  signal?: AbortSignal,
): Promise<ValhallaTraceResponse> {
  const request = (shapeMatch: 'edge_walk' | 'walk_or_snap') =>
    post<ValhallaTraceResponse>(
      '/trace_attributes',
      {
        encoded_polyline: result.encodedShape ?? encodePolyline(result.geometry),
        shape_match: shapeMatch,
        costing: activity === 'cycle' ? 'bicycle' : 'pedestrian',
        filters: {
          action: 'include',
          attributes: [
            'edge.names', 'edge.length', 'edge.road_class', 'edge.begin_shape_index',
            'edge.end_shape_index', 'edge.use', 'edge.unpaved', 'edge.surface',
            'edge.travel_mode', 'edge.travel_type', 'edge.max_upward_grade',
            'edge.max_downward_grade', 'edge.lane_count', 'edge.cycle_lane',
            'edge.bicycle_network', 'edge.shoulder', 'edge.sidewalk', 'edge.way_id',
            'edge.speed',
          ],
        },
      },
      signal,
    );
  try {
    return await request('edge_walk');
  } catch (error) {
    if (!(error instanceof RoutingError) || error.errorCode !== 443) throw error;
    return request('walk_or_snap');
  }
}
