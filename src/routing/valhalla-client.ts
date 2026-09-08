import { costingOptions } from "../domain/activity-profiles";
import { isClosedShape } from "../domain/geometry";
import type { Coordinate, RoutePlan, RouteResult } from "../domain/models";
import { encodePolyline, mapTrip } from "./valhalla-mapper";
import type {
  ValhallaRouteResponse,
  ValhallaTraceResponse,
} from "./valhalla-types";

const BASE = import.meta.env.VITE_VALHALLA_URL ?? "/api/valhalla";
// Generated bearings describe an area to shape the loop, not a place to visit.
const GENERATED_LOOP_RADIUS_M = 150;

class RoutingError extends Error {
  constructor(message: string, readonly errorCode?: number) {
    super(message);
  }
}

async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new Error(
      "The routing service is unavailable. Your current route and map are still usable.",
    );
  }
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
    error_code?: number;
  };
  if (!response.ok || data.error) {
    const outside = data.error_code === 171 || data.error_code === 442;
    const unavailable = response.status >= 500 && !data.error;
    throw new RoutingError(
      outside
        ? "Routing data is not loaded for this area. You can still move the map and choose another location."
        : unavailable
          ? "The routing service is unavailable. Your current route and map are still usable."
          : data.error || `Routing failed (${response.status}).`,
      data.error_code,
    );
  }
  return data;
}

function locations(plan: RoutePlan) {
  return plan.waypoints.map((point, index) => {
    const generated = point.role === "generated";
    return {
      lat: point.coordinate.lat,
      lon: point.coordinate.lon,
      type:
        index === 0 || index === plan.waypoints.length - 1
          ? "break"
          : "through",
      ...(generated
        ? {
            radius: GENERATED_LOOP_RADIUS_M,
            rank_candidates: false,
          }
        : {}),
    };
  });
}

export async function routePlan(
  plan: RoutePlan,
  signal?: AbortSignal,
  alternatives = true,
): Promise<RouteResult[]> {
  if (plan.waypoints.length < 2) return [];
  const data = await post<ValhallaRouteResponse>(
    "/route",
    {
      locations: locations(plan),
      costing: plan.activity === "cycle" ? "bicycle" : "pedestrian",
      costing_options: {
        [plan.activity === "cycle" ? "bicycle" : "pedestrian"]: costingOptions(
          plan.activity,
          plan.preferences,
        ),
      },
      units: "kilometers",
      elevation_interval: 30,
      alternates: alternatives && plan.waypoints.length === 2 ? 2 : 0,
    },
    signal,
  );
  if (!data.trip) throw new Error("The routing service returned no route.");
  return [
    mapTrip(data.trip),
    ...(data.alternates ?? []).flatMap((item) =>
      item.trip ? [mapTrip(item.trip)] : [],
    ),
  ];
}

/**
 * The network distance boundary around `start`, as a ring of coordinates.
 *
 * Placing loop shaping points on a plain circle inherits whatever detour factor
 * the local network happens to have, and it overshot the target on every one of
 * 32 measured seeds — a median of +13% for a 10 km run and +15% for a 30 km
 * cycle. A contour is expressed in the distance actually being targeted, so the
 * same constant works across activities and distances, and it follows the real
 * network: a river or a motorway shapes the candidates instead of being crossed
 * on paper and corrected a round trip later.
 */
export async function distanceContour(
  start: Coordinate,
  distanceKm: number,
  activity: RoutePlan["activity"],
  preferences: RoutePlan["preferences"],
  signal?: AbortSignal,
): Promise<Coordinate[] | undefined> {
  const costing = activity === "cycle" ? "bicycle" : "pedestrian";
  try {
    const data = await post<{
      features?: Array<{
        geometry?: { type?: string; coordinates?: unknown };
      }>;
    }>(
      "/isochrone",
      {
        locations: [{ lat: start.lat, lon: start.lon }],
        costing,
        costing_options: { [costing]: costingOptions(activity, preferences) },
        contours: [{ distance: Number(distanceKm.toFixed(2)) }],
        polygons: true,
        denoise: 0.4,
        generalize: 60,
      },
      signal,
    );
    const geometry = data.features?.[0]?.geometry;
    if (!geometry) return undefined;
    const polygons = (
      geometry.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][])
        : [geometry.coordinates as number[][][]]
    ).flatMap((polygon) => (polygon[0] ? [polygon[0]] : []));
    const ring = polygons.sort((a, b) => b.length - a.length)[0];
    if (!ring || ring.length < 8) return undefined;
    return ring.flatMap((point) =>
      Array.isArray(point) &&
      typeof point[0] === "number" &&
      typeof point[1] === "number"
        ? [{ lat: point[1], lon: point[0] }]
        : [],
    );
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    // A loop can still be seeded from a circle, so this is never fatal.
    return undefined;
  }
}

export async function traceRoute(
  result: RouteResult,
  activity: RoutePlan["activity"],
  signal?: AbortSignal,
): Promise<ValhallaTraceResponse> {
  const request = (shapeMatch: "edge_walk" | "walk_or_snap") =>
    post<ValhallaTraceResponse>(
      "/trace_attributes",
      {
        encoded_polyline:
          result.encodedShape ?? encodePolyline(result.geometry),
        shape_match: shapeMatch,
        costing: activity === "cycle" ? "bicycle" : "pedestrian",
        filters: {
          action: "include",
          attributes: [
            "edge.names",
            "edge.length",
            "edge.road_class",
            "edge.begin_shape_index",
            "edge.end_shape_index",
            "edge.use",
            "edge.unpaved",
            "edge.surface",
            "edge.travel_mode",
            "edge.travel_type",
            "edge.max_upward_grade",
            "edge.max_downward_grade",
            "edge.lane_count",
            "edge.cycle_lane",
            "edge.bicycle_network",
            "edge.speed",
            "edge.shoulder",
            "edge.sidewalk",
            "edge.way_id",
            "osm_changeset",
          ],
        },
      },
      signal,
    );
  // Valhalla refuses an exact edge walk over a closed shape, so a loop goes
  // straight to the fallback rather than spending a round trip on error 443.
  if (isClosedShape(result.geometry)) return request("walk_or_snap");
  try {
    return await request("edge_walk");
  } catch (error) {
    if (!(error instanceof RoutingError) || error.errorCode !== 443) throw error;
    return request("walk_or_snap");
  }
}

export async function routingStatus(signal?: AbortSignal): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/status`, { signal });
    return r.ok;
  } catch {
    return false;
  }
}
