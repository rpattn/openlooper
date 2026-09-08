import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { UnitSystem } from '../../../../src/domain/units';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SettingsContext,
  type Settings,
} from './settings-context';

/**
 * Preferences that outlive a route. Kept apart from the planner's session state:
 * these are the planner's own settings, not part of any one route, and they must
 * survive clearing or discarding one.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : undefined;
        if (saved?.units === 'metric' || saved?.units === 'imperial')
          setSettings({ units: saved.units });
      })
      .catch(() => {
        // A device that cannot store settings still runs on the defaults.
      })
      .finally(() => setLoaded(true));
  }, []);

  const setUnits = useCallback((units: UnitSystem) => {
    setSettings({ units });
    void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ units })).catch(() => {});
  }, []);

  const value = useMemo(() => ({ ...settings, loaded, setUnits }), [loaded, setUnits, settings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
