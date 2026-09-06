export {
  initialState as initialPlannerState,
  normalizedWaypoints,
  reducer as plannerReducer,
  routePlan,
} from '../../../../src/app/state';
export type { Action as PlannerAction } from '../../../../src/app/state';
export * from '../../../../src/domain/models';

import { Platform } from 'react-native';

import type { MapStyleId } from '../../../../src/domain/models';

export const ACTIVITY = {
  run: { label: 'Run', color: '#e85d3f' },
  walk: { label: 'Walk', color: '#247d60' },
  cycle: { label: 'Cycle', color: '#3166c7' },
} as const;

export const CREATION_MODES = [
  { value: 'pointToPoint', label: 'A → B' },
  { value: 'loop', label: 'Loop' },
  { value: 'sketch', label: 'Sketch' },
] as const;

/** Base map choices, in the order they appear in the map-style control. The
 * web map has no free imagery source, so it offers the vector styles only. */
export const MAP_STYLES: readonly { value: MapStyleId; label: string }[] =
  Platform.OS === 'web'
    ? [
        { value: 'standard', label: 'Map' },
        { value: 'muted', label: 'Muted' },
      ]
    : [
        { value: 'standard', label: 'Map' },
        { value: 'muted', label: 'Muted' },
        { value: 'satellite', label: 'Satellite' },
        { value: 'hybrid', label: 'Hybrid' },
      ];
