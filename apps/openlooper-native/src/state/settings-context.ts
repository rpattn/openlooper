import { createContext, useContext } from 'react';

import type { UnitSystem } from '../../../../src/domain/units';

export const SETTINGS_KEY = 'openlooper-settings';

export type Settings = { units: UnitSystem };
export const DEFAULT_SETTINGS: Settings = { units: 'metric' };

export type SettingsStore = Settings & {
  /** False until the stored choice has been read, so nothing is written over it. */
  loaded: boolean;
  setUnits: (units: UnitSystem) => void;
};

export const SettingsContext = createContext<SettingsStore>({
  ...DEFAULT_SETTINGS,
  loaded: true,
  setUnits: () => {},
});

export function useSettings(): SettingsStore {
  return useContext(SettingsContext);
}

/** The measurement system on its own, which is all most callers want. */
export function useUnits(): UnitSystem {
  return useContext(SettingsContext).units;
}
