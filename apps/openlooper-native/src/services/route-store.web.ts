import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RoutePlan, RouteResult } from '@/domain/models';
import type { SavedRoute, SavedRoutePage, SavedRouteSummary } from '@/domain/saved-route';
import { summaryOf } from '@/domain/saved-route';

/**
 * Web stand-in for the device's SQLite library.
 *
 * `expo-sqlite`'s web build reaches its worker through a `SharedArrayBuffer`,
 * which needs the page to be cross-origin isolated. The COEP header that takes
 * would also block the map tiles, glyphs and MapLibre worker the web map loads
 * from other origins, so the browser keeps its own store instead.
 *
 * The shape matches the SQLite one: an index holding exactly what the list
 * draws, and one entry per route holding the payload, so paging never reads a
 * route it is not showing and a route too large to store fails on its own.
 */
const INDEX_KEY = 'openlooper-routes';
const payloadKey = (id: string) => `openlooper-route:${id}`;

async function readIndex(): Promise<SavedRouteSummary[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    const parsed = raw ? (JSON.parse(raw) as SavedRouteSummary[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(items: SavedRouteSummary[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(items));
}

export async function listRoutes(offset: number, limit: number): Promise<SavedRoutePage> {
  const items = await readIndex();
  const ordered = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    items: ordered.slice(offset, offset + limit),
    total: ordered.length,
    totalDistanceKm: ordered.reduce((total, item) => total + item.distanceKm, 0),
  };
}

export async function loadRoute(id: string): Promise<SavedRoute | undefined> {
  const summary = (await readIndex()).find((item) => item.id === id);
  if (!summary) return undefined;
  const raw = await AsyncStorage.getItem(payloadKey(id));
  if (!raw) return undefined;
  const payload = JSON.parse(raw) as { plan: RoutePlan; route: RouteResult };
  return { ...summary, plan: payload.plan, route: payload.route };
}

export async function putRoute(route: SavedRoute): Promise<SavedRouteSummary> {
  const summary = summaryOf(route);
  await AsyncStorage.setItem(
    payloadKey(route.id),
    JSON.stringify({ plan: route.plan, route: route.route }),
  );
  const items = await readIndex();
  await writeIndex([summary, ...items.filter((item) => item.id !== route.id)]);
  return summary;
}

export async function deleteRoute(id: string): Promise<void> {
  const items = await readIndex();
  await writeIndex(items.filter((item) => item.id !== id));
  await AsyncStorage.removeItem(payloadKey(id));
}
