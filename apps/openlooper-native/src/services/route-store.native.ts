import * as SQLite from 'expo-sqlite';

import type { Coordinate, RoutePlan, RouteResult } from '@/domain/models';
import type { SavedRoute, SavedRoutePage, SavedRouteSummary } from '@/domain/saved-route';
import { summaryOf } from '@/domain/saved-route';

/**
 * Saved routes on a device. The columns are exactly what the list draws, so a
 * page of cards is one small query; the route itself lives in `payload` and is
 * only read when a route is opened.
 */
type Row = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  activity: string;
  mode: string;
  distance_km: number;
  duration_seconds: number;
  ascent_m: number | null;
  descent_m: number | null;
  outline: string;
};

let database: Promise<SQLite.SQLiteDatabase> | undefined;

function open() {
  database ??= SQLite.openDatabaseAsync('openlooper-routes.db').then(async (db) => {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        activity TEXT NOT NULL,
        mode TEXT NOT NULL,
        distance_km REAL NOT NULL,
        duration_seconds REAL NOT NULL,
        ascent_m REAL,
        descent_m REAL,
        outline TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS routes_updated_at ON routes (updated_at DESC);
    `);
    return db;
  });
  return database;
}

function summary(row: Row): SavedRouteSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activity: row.activity as SavedRouteSummary['activity'],
    mode: row.mode as SavedRouteSummary['mode'],
    distanceKm: row.distance_km,
    durationSeconds: row.duration_seconds,
    ascentM: row.ascent_m ?? undefined,
    descentM: row.descent_m ?? undefined,
    outline: JSON.parse(row.outline) as Coordinate[],
  };
}

export async function listRoutes(offset: number, limit: number): Promise<SavedRoutePage> {
  const db = await open();
  const rows = await db.getAllAsync<Row>(
    `SELECT id, name, created_at, updated_at, activity, mode, distance_km, duration_seconds,
            ascent_m, descent_m, outline
       FROM routes ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const totals = await db.getFirstAsync<{ total: number; distance: number | null }>(
    'SELECT COUNT(*) AS total, SUM(distance_km) AS distance FROM routes',
  );
  return {
    items: rows.map(summary),
    total: totals?.total ?? 0,
    totalDistanceKm: totals?.distance ?? 0,
  };
}

export async function loadRoute(id: string): Promise<SavedRoute | undefined> {
  const db = await open();
  const row = await db.getFirstAsync<Row & { payload: string }>(
    'SELECT * FROM routes WHERE id = ?',
    [id],
  );
  if (!row) return undefined;
  const payload = JSON.parse(row.payload) as { plan: RoutePlan; route: RouteResult };
  return { ...summary(row), plan: payload.plan, route: payload.route };
}

export async function putRoute(route: SavedRoute): Promise<SavedRouteSummary> {
  const db = await open();
  await db.runAsync(
    `INSERT OR REPLACE INTO routes
       (id, name, created_at, updated_at, activity, mode, distance_km, duration_seconds,
        ascent_m, descent_m, outline, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      route.id,
      route.name,
      route.createdAt,
      route.updatedAt,
      route.activity,
      route.mode,
      route.distanceKm,
      route.durationSeconds,
      route.ascentM ?? null,
      route.descentM ?? null,
      JSON.stringify(route.outline),
      JSON.stringify({ plan: route.plan, route: route.route }),
    ],
  );
  return summaryOf(route);
}

export async function deleteRoute(id: string): Promise<void> {
  const db = await open();
  await db.runAsync('DELETE FROM routes WHERE id = ?', [id]);
}
