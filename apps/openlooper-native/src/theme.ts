import { Platform } from 'react-native';

/** Single source of truth for the planner's colours and surface treatments, so
 * the glass (iOS) and solid (Android/web) variants of a control stay in step. */
export const COLOR = {
  ink: '#172019',
  muted: '#68736b',
  faint: '#89948c',
  line: 'rgba(23,32,25,0.12)',
  surface: '#fafbf7',
  panel: '#f0f2ed',
  raised: '#ffffff',
  field: '#e8ece5',
  start: '#177657',
  via: '#273f78',
  finish: '#b83c34',
  warning: '#d77b16',
  danger: '#b3261e',
  highlight: '#ffd24a',
} as const;

export const GLASS = Platform.OS === 'ios';

export const RADIUS = { sheet: 28, panel: 14, control: 12, pill: 999 } as const;

export const SHADOW = {
  floating: {
    shadowColor: '#202d23',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  sheet: {
    shadowColor: '#202d23',
    shadowOpacity: 0.2,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
} as const;
