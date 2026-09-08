import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { COLOR } from '@/theme';
import type { Coordinate } from '@/domain/models';
import { formatDistance } from '../../../../../src/domain/units';
import { useUnits } from '@/state/settings-context';
import type { SeriesPoint } from '../../../../../src/domain/route-series';
import { indexAtRatio } from './series-model';

export type SeriesScrubberProps = {
  points: SeriesPoint[];
  accent: string;
  height: number;
  label: string;
  /** Formats the value under the cursor, units included. */
  format: (value: number) => string;
  /** Where the cursor sits when something other than this chart put it there —
   * a touch on the map. Undefined means nothing is selected. */
  cursorKm?: number;
  onPoint: (coordinate?: Coordinate, distanceKm?: number) => void;
  /** The platform's chart, stretched to fill the plot area. */
  children: ReactNode;
};

/**
 * Wraps whichever chart the platform drew in a touch layer, so dragging across
 * the profile locates that position on the map identically everywhere. The
 * cursor and readout are drawn in React Native for exact alignment.
 */
export function SeriesScrubber({
  points,
  accent,
  height,
  label,
  format,
  cursorKm,
  onPoint,
  children,
}: SeriesScrubberProps) {
  const units = useUnits();
  const [width, setWidth] = useState(0);
  const size = useRef(0);
  const emit = useRef(onPoint);
  emit.current = onPoint;
  const count = points.length;
  // The cursor is wherever the shared position says it is, whichever end put it
  // there. Dragging here reports a position rather than keeping its own, so the
  // map and the chart can never disagree about where along the route this is.
  const index = useMemo(() => {
    if (cursorKm === undefined || !count) return undefined;
    let best = 0;
    let bestGap = Infinity;
    points.forEach((point, position) => {
      const gap = Math.abs(point.distanceKm - cursorKm);
      if (gap < bestGap) {
        bestGap = gap;
        best = position;
      }
    });
    return best;
  }, [count, cursorKm, points]);

  const responder = useMemo(() => {
    let reported: number | undefined;
    const scrub = (x: number) => {
      const next = indexAtRatio(count, x / (size.current || 1));
      // Re-rendering the map marker on every touch event is wasted work, so
      // only report a genuinely new position.
      if (reported === next) return;
      reported = next;
      const point = points[next];
      emit.current(point?.coordinate, point?.distanceKm);
    };
    return PanResponder.create({
      // Capture before the chart so a drag never reaches the surrounding scroll.
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event) => scrub(event.nativeEvent.locationX),
      onPanResponderMove: (event) => scrub(event.nativeEvent.locationX),
    });
  }, [count, points]);

  const selected = index === undefined ? undefined : points[index];
  const left = index === undefined || count < 2 ? 0 : (index / (count - 1)) * width;

  function layout(event: LayoutChangeEvent) {
    size.current = event.nativeEvent.layout.width;
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View style={styles.wrap}>
      <View
        {...responder.panHandlers}
        onLayout={layout}
        accessibilityRole="adjustable"
        accessibilityLabel={`${label} profile`}
        style={[styles.plot, { height }]}
      >
        {children}
        {selected && (
          <View
            pointerEvents="none"
            style={[styles.cursor, { left, height, backgroundColor: accent }]}
          />
        )}
      </View>
      <View style={styles.readoutRow}>
        <Text style={styles.readout}>
          {selected
            ? `${formatDistance(selected.distanceKm, units)} · ${format(selected.value)}`
            : 'Drag across the profile to locate it on the map.'}
        </Text>
        {selected && (
          <Text
            accessibilityRole="button"
            onPress={() => emit.current(undefined)}
            style={[styles.clear, { color: accent }]}
          >
            Clear
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  plot: { position: 'relative', overflow: 'hidden', borderRadius: 10 },
  cursor: { position: 'absolute', top: 0, width: 2, marginLeft: -1, opacity: 0.85, borderRadius: 1 },
  readoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  readout: { flex: 1, color: COLOR.muted, fontSize: 11, lineHeight: 16 },
  clear: { fontSize: 11, fontWeight: '800' },
});
