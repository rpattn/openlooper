import type { SFSymbol } from 'sf-symbols-typescript';
import type { StyleProp, ViewStyle } from 'react-native';

import type { ColourSpan, LegendEntry } from '../../../../../src/domain/route-overlays';
import type { RouteSeries } from '../../../../../src/domain/route-series';
import type { Coordinate, WaypointRole } from '@/domain/models';

export type SegmentedOption<T extends string> = { value: T; label: string };

export type SegmentedProps<T extends string> = {
  values: readonly SegmentedOption<T>[];
  selected: T;
  accent: string;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

export type GlassSurfaceProps = {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `clear` reads the map through the surface; `regular` is the frosted card. */
  variant?: 'regular' | 'clear';
  tint?: string;
  pointerEvents?: 'auto' | 'none' | 'box-none' | 'box-only';
};

export type IconButtonProps = {
  /** SF Symbol name; the fallback variant renders `fallbackLabel` instead. */
  symbol: SFSymbol;
  fallbackLabel: string;
  accessibilityLabel: string;
  onPress: () => void;
  accent?: string;
  size?: number;
  active?: boolean;
  disabled?: boolean;
};

export type WaypointRow = {
  id: string;
  title: string;
  /** The same token the map draws on this point's pin. */
  marker: string;
  subtitle: string;
  role: WaypointRole;
  index: number;
  /** Fixed rows (a loop's return-to-start) cannot be dragged or deleted. */
  locked: boolean;
  /** How far the route covers getting to this point from the one before it.
   * Absent on the first point, and while no route has been calculated. */
  legKm?: number;
  /** That distance in the planner's chosen units, ready to read. */
  legLabel?: string;
};

export type WaypointListProps = {
  rows: WaypointRow[];
  accent: string;
  /** While inspecting, the list reads out the points without offering to change them. */
  editable: boolean;
  onMove: (from: number, to: number) => void;
  onDelete: (index: number) => void;
  onSelect: (id: string) => void;
};

export type ProfileChartProps = {
  /** Whatever the active colouring plots against distance. */
  series: RouteSeries;
  /** Where the cursor sits, when the map put it there rather than the chart. */
  cursorKm?: number;
  /** The route's colouring, laid out along the same distance axis. */
  spans: ColourSpan[];
  totalKm: number;
  legend: LegendEntry[];
  accent: string;
  onPoint: (coordinate?: Coordinate, distanceKm?: number) => void;
};
