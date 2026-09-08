import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PlannerState } from '../../../../src/domain/models';
import { DEFAULT_MAP_STYLE, DEFAULT_OVERLAY } from '../../../../src/domain/models';

const KEY = 'openlooper-session';
const FORMAT = 1;

export async function restorePlanner(): Promise<PlannerState | undefined> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as { format?: number; state?: PlannerState };
    if (saved.format !== FORMAT || !saved.state?.plan || !saved.state.camera) return undefined;
    return {
      ...saved.state,
      mapStyle: saved.state.mapStyle ?? DEFAULT_MAP_STYLE,
      overlay: saved.state.overlay ?? DEFAULT_OVERLAY,
      interaction: saved.state.interaction ?? 'edit',
      loopTuned: Boolean(saved.state.loopTuned),
      loading: false,
      progress: undefined,
      error: undefined,
      profilePoint: undefined,
      profileKm: undefined,
      previousDistanceKm: undefined,
      highlightedIssueId: undefined,
      highlightedEdgeIndex: undefined,
      // Undo steps back through edits made to a route that is on screen. After a
      // reload there is nothing on screen to step back from, so the stack starts
      // empty rather than restoring shapes the planner never saw.
      past: [],
      future: [],
    };
  } catch {
    return undefined;
  }
}

export async function persistPlanner(state: PlannerState): Promise<void> {
  const clean = {
    ...state,
    // Evidence segment geometry is only needed while the route is on screen and
    // is large enough to blow the storage quota on its own.
    selectedRoute: state.selectedRoute && {
      ...state.selectedRoute,
      useEvidence: state.selectedRoute.useEvidence && {
        ...state.selectedRoute.useEvidence,
        segments: undefined,
      },
    },
    loading: false,
    progress: undefined,
    error: undefined,
    profilePoint: undefined,
    profileKm: undefined,
    previousDistanceKm: undefined,
    highlightedIssueId: undefined,
    highlightedEdgeIndex: undefined,
    past: [],
    future: [],
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ format: FORMAT, state: clean }));
  } catch {
    try {
      await AsyncStorage.setItem(
        KEY,
        JSON.stringify({ format: FORMAT, state: { ...clean, alternatives: [] } }),
      );
    } catch {
      // Planning remains usable when storage is full or disabled.
    }
  }
}
