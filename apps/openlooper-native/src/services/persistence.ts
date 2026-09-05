import AsyncStorage from '@react-native-async-storage/async-storage';

import type { PlannerState } from '../../../../src/domain/models';

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
      loading: false,
      progress: undefined,
      error: undefined,
      profilePoint: undefined,
      highlightedIssueId: undefined,
      highlightedEdgeIndex: undefined,
    };
  } catch {
    return undefined;
  }
}

export async function persistPlanner(state: PlannerState): Promise<void> {
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
