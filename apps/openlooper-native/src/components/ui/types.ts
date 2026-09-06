import type { SFSymbol } from 'sf-symbols-typescript';
import type { StyleProp, ViewStyle } from 'react-native';

import type { Coordinate, ElevationPoint, WaypointRole } from '@/domain/models';

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
  subtitle: string;
  role: WaypointRole;
  index: number;
  /** Fixed rows (a loop's return-to-start) cannot be dragged or deleted. */
  locked: boolean;
};

export type WaypointListProps = {
  rows: WaypointRow[];
  accent: string;
  onMove: (from: number, to: number) => void;
  onDelete: (index: number) => void;
  onSelect: (id: string) => void;
};

export type ElevationChartProps = {
  points: ElevationPoint[];
  accent: string;
  onPoint: (coordinate?: Coordinate) => void;
};
