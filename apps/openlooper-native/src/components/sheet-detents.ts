import type { SheetState } from '@/domain/models';

/**
 * How much of the screen the sheet covers at each detent. The map reads the
 * same numbers to fit routes clear of the sheet and to frame a located point in
 * the strip that stays visible, so the two can never drift apart.
 */
export const SHEET_FRACTION: Record<Exclude<SheetState, 'collapsed'>, number> = {
  half: 0.48,
  full: 0.92,
};

/** Stand-in for the measured peek height before the sheet has laid out. */
export const COLLAPSED_FALLBACK = 132;

export function sheetHeightFor(sheet: SheetState, windowHeight: number): number {
  if (sheet === 'collapsed') return COLLAPSED_FALLBACK;
  return Math.round(windowHeight * SHEET_FRACTION[sheet]);
}
