import { Chart, Host } from '@expo/ui/swift-ui';
import { opacity } from '@expo/ui/swift-ui/modifiers';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLOR } from '@/theme';
import { elevationSummary, sampleElevation } from './elevation-model';
import { ElevationScrubber } from './elevation-scrubber';
import type { ElevationChartProps } from './types';

const HEIGHT = 132;
const SAMPLES = 110;

/**
 * Swift Charts profile: a filled area with a crisp top line drawn as a second
 * chart above it. `showGrid` stays off so the plot fills the host exactly and
 * the React Native cursor lines up with the data.
 */
export function ElevationChart({ points, accent, onPoint }: ElevationChartProps) {
  const samples = useMemo(() => sampleElevation(points, SAMPLES), [points]);
  const summary = useMemo(() => elevationSummary(samples), [samples]);
  const data = useMemo(
    () => samples.map((point) => ({ x: point.distanceKm, y: point.elevationM })),
    [samples],
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{Math.round(summary.max)} m</Text>
        <Text style={styles.axisText}>{Math.round(summary.min)} m</Text>
      </View>
      <ElevationScrubber
        points={samples}
        summary={summary}
        accent={accent}
        height={HEIGHT}
        onPoint={onPoint}
      >
        <View style={styles.grid} pointerEvents="none">
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
          <View style={styles.gridLine} />
        </View>
        <Host style={StyleSheet.absoluteFill} pointerEvents="none" colorScheme="light">
          {/* Tinting through `opacity` avoids relying on how eight-digit hex
              alpha is parsed on the Swift side. */}
          <Chart
            data={data}
            type="area"
            showGrid={false}
            areaStyle={{ color: accent }}
            modifiers={[opacity(0.22)]}
          />
        </Host>
        <Host style={StyleSheet.absoluteFill} pointerEvents="none" colorScheme="light">
          <Chart data={data} type="line" showGrid={false} lineStyle={{ color: accent, width: 2.5 }} />
        </Host>
      </ElevationScrubber>
      <View style={styles.footer}>
        <Text style={styles.axisText}>0 km</Text>
        <Text style={styles.axisText}>{summary.distanceKm.toFixed(1)} km</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: COLOR.faint, fontSize: 10, fontVariant: ['tabular-nums'] },
  grid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'space-evenly', zIndex: 1 },
  gridLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLOR.line },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
});
