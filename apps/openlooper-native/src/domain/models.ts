export * from '../../../../src/domain/models';

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
