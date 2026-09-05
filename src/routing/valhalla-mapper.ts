import { elevationProfile } from "../domain/elevation";
import { routeBounds } from "../domain/geometry";
import { randomId } from "../domain/id";
import type { Coordinate, RouteLeg, RouteResult } from "../domain/models";
import type { ValhallaTrip } from "./valhalla-types";

export function decodePolyline(encoded: string, precision = 6): Coordinate[] {
  let index = 0,
    lat = 0,
    lon = 0;
  const factor = 10 ** precision;
  const result: Coordinate[] = [];
  while (index < encoded.length) {
    let byte = 0,
      shift = 0,
      value = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    lat += value & 1 ? ~(value >> 1) : value >> 1;
    shift = 0;
    value = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    lon += value & 1 ? ~(value >> 1) : value >> 1;
    result.push({ lat: lat / factor, lon: lon / factor });
  }
  return result;
}

export function encodePolyline(points: Coordinate[], precision = 6): string {
  const factor = 10 ** precision;
  let lastLat = 0,
    lastLon = 0,
    encoded = "";
  const append = (input: number) => {
    let value = input < 0 ? ~(input << 1) : input << 1;
    while (value >= 32) {
      encoded += String.fromCharCode((32 | (value & 31)) + 63);
      value >>= 5;
    }
    encoded += String.fromCharCode(value + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * factor);
    const lon = Math.round(point.lon * factor);
    append(lat - lastLat);
    append(lon - lastLon);
    lastLat = lat;
    lastLon = lon;
  }
  return encoded;
}

export function mapTrip(
  trip: ValhallaTrip,
  id = randomId(),
): RouteResult {
  const rawLegs = trip.legs ?? [];
  const geometry: Coordinate[] = [];
  const elevations: number[] = [];
  const legs: RouteLeg[] = [];
  for (const leg of rawLegs) {
    const beginIndex = Math.max(0, geometry.length - 1);
    const points = decodePolyline(leg.shape ?? "");
    if (geometry.length && points.length) points.shift();
    geometry.push(...points);
    legs.push({
      beginIndex,
      endIndex: geometry.length - 1,
      distanceKm: leg.summary?.length ?? 0,
      durationSeconds: leg.summary?.time ?? 0,
    });
    const samples = leg.elevation ?? [];
    if (elevations.length && samples.length) samples.shift();
    elevations.push(...samples);
  }
  if (geometry.length < 2)
    throw new Error("The routing service returned no usable route geometry.");
  const distanceKm =
    trip.summary?.length ?? legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  const durationSeconds =
    trip.summary?.time ??
    legs.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  const profile = elevationProfile(geometry, elevations, distanceKm);
  return {
    id,
    geometry,
    legs,
    distanceKm,
    durationSeconds,
    ascentM: profile.points.length ? profile.ascent : undefined,
    descentM: profile.points.length ? profile.descent : undefined,
    elevation: profile.points,
    bounds: routeBounds(geometry),
    issues: [],
    edges: [],
    encodedShape:
      rawLegs.length === 1 ? rawLegs[0]?.shape : encodePolyline(geometry),
  };
}
