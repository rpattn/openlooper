import type { PlannerState } from "../domain/models";
import { initialState } from "./state";

const KEY = "openlooper-session";
const FORMAT = 1;
type Saved = { format: number; state: PlannerState };
type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;
const coordinate = (value: unknown): boolean =>
  record(value) && Number.isFinite(value.lat) && Number.isFinite(value.lon);
const route = (value: unknown): boolean =>
  record(value) &&
  typeof value.id === "string" &&
  typeof value.encodedShape === "string" &&
  Number.isFinite(value.distanceKm) &&
  Number.isFinite(value.durationSeconds) &&
  Array.isArray(value.geometry) &&
  value.geometry.length >= 2 &&
  value.geometry.every(coordinate) &&
  Array.isArray(value.bounds) &&
  value.bounds.length === 2 &&
  value.bounds.every(coordinate) &&
  Array.isArray(value.legs) &&
  Array.isArray(value.elevation) &&
  Array.isArray(value.issues) &&
  Array.isArray(value.edges);

function valid(value: unknown): value is Saved {
  if (!record(value) || value.format !== FORMAT || !record(value.state))
    return false;
  const state = value.state;
  if (
    !record(state.camera) ||
    !coordinate(state.camera.center) ||
    !Number.isFinite(state.camera.zoom) ||
    !record(state.plan)
  )
    return false;
  const plan = state.plan;
  if (
    !["run", "walk", "cycle"].includes(String(plan.activity)) ||
    !["pointToPoint", "loop", "sketch"].includes(String(plan.mode)) ||
    !record(plan.preferences) ||
    !Array.isArray(plan.waypoints)
  )
    return false;
  if (
    !plan.waypoints.every(
      (point) =>
        record(point) &&
        typeof point.id === "string" &&
        coordinate(point.coordinate),
    )
  )
    return false;
  if (state.selectedRoute !== undefined && !route(state.selectedRoute))
    return false;
  if (
    !Array.isArray(state.alternatives) ||
    !state.alternatives.every(
      (item) =>
        record(item) && typeof item.id === "string" && route(item.result),
    )
  )
    return false;
  return (
    typeof state.loading === "boolean" &&
    typeof state.activeTool === "string" &&
    typeof state.sheet === "string" &&
    Number.isFinite(state.loopSeed)
  );
}

export function restore(): PlannerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState;
    const value: unknown = JSON.parse(raw);
    return valid(value)
      ? {
          ...value.state,
          loading: false,
          progress: undefined,
          error: undefined,
          profilePoint: undefined,
          highlightedIssueId: undefined,
          highlightedEdgeIndex: undefined,
        }
      : initialState;
  } catch {
    return initialState;
  }
}

export function persist(state: PlannerState) {
  const clean = {
    ...state,
    loading: false,
    progress: undefined,
    error: undefined,
    profilePoint: undefined,
    highlightedIssueId: undefined,
    highlightedEdgeIndex: undefined,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify({ format: FORMAT, state: clean }));
  } catch {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          format: FORMAT,
          state: { ...clean, alternatives: [] },
        }),
      );
    } catch {
      /* Storage may be unavailable; planning remains usable. */
    }
  }
}
