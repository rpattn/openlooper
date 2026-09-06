import { useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { COLOR } from '@/theme';
import type { Coordinate, ElevationPoint } from '@/domain/models';
import { indexAtRatio, type ElevationSummary } from './elevation-model';

export type ScrubberProps = {
  points: ElevationPoint[];
  summary: ElevationSummary;
  accent: string;
  height: number;
  onPoint: (coordinate?: Coordinate) => void;
  /** The platform's chart, stretched to fill the plot area. */
  children: ReactNode;
};

/**
 * Wraps whichever chart the platform drew in a touch layer, so dragging across
 * the profile locates that position on the map identically everywhere. The
 * cursor and readout are drawn in React Native for exact alignment.
 */
export function ElevationScrubber({
  points,
  summary,
  accent,
  height,
  onPoint,
  children,
}: ScrubberProps) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState<number>();
  const size = useRef(0);
  const emit = useRef(onPoint);
  emit.current = onPoint;
  const count = points.length;

  const responder = useMemo(() => {
    const scrub = (x: number) => {
      const next = indexAtRatio(count, x / (size.current || 1));
      // Re-rendering the map marker on every touch event is wasted work, so
      // only report a genuinely new position.
      setIndex((previous) => {
        if (previous === next) return previous;
        emit.current(points[next]?.coordinate);
        return next;
      });
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
        accessibilityLabel={`Elevation profile from ${Math.round(summary.min)} to ${Math.round(summary.max)} metres`}
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
            ? `${selected.distanceKm.toFixed(1)} km · ${Math.round(selected.elevationM)} m`
            : 'Drag across the profile to locate it on the map.'}
        </Text>
        {selected && (
          <Text
            accessibilityRole="button"
            onPress={() => {
              setIndex(undefined);
              emit.current(undefined);
            }}
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
