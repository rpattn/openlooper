import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLOR } from '@/theme';
import { elevationSummary, sampleElevation } from './elevation-model';
import { ElevationScrubber } from './elevation-scrubber';
import type { ElevationChartProps } from './types';

const HEIGHT = 132;
const COLUMNS = 72;

/**
 * Android/web area profile. Butted columns with a coloured cap read as a filled
 * area under a line without pulling in an SVG renderer.
 */
export function ElevationChart({ points, accent, onPoint }: ElevationChartProps) {
  const samples = useMemo(() => sampleElevation(points, COLUMNS), [points]);
  const summary = useMemo(() => elevationSummary(samples), [samples]);
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
        <View style={styles.columns} pointerEvents="none">
          {samples.map((point, index) => (
            <View
              key={`${index}-${point.distanceKm}`}
              style={[
                styles.column,
                {
                  height: 6 + ((point.elevationM - summary.min) / summary.range) * (HEIGHT - 14),
                  backgroundColor: `${accent}26`,
                  borderTopColor: accent,
                },
              ]}
            />
          ))}
        </View>
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
  grid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'space-evenly' },
  gridLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLOR.line },
  columns: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, borderTopWidth: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
});
