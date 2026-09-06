import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { COLOR } from '@/theme';
import { ColourStrip } from './colour-strip';
import { Legend } from './legend';
import { sampleSeries, seriesSummary } from './series-model';
import { SeriesScrubber } from './series-scrubber';
import type { ProfileChartProps } from './types';

const HEIGHT = 132;
const COLUMNS = 72;

/**
 * Android/web profile. Butted columns with a coloured cap read as a filled area
 * under a line without pulling in an SVG renderer.
 */
export function ProfileChart({
  series,
  spans,
  totalKm,
  legend,
  accent,
  onPoint,
}: ProfileChartProps) {
  const samples = useMemo(() => sampleSeries(series.points, COLUMNS), [series.points]);
  const summary = useMemo(() => seriesSummary(samples), [samples]);
  const format = (value: number) => `${value.toFixed(series.precision)}${series.unit}`;
  if (!samples.length) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.axis}>
        <Text style={styles.axisText}>{format(summary.max)}</Text>
        <Text style={styles.axisText}>{format(summary.min)}</Text>
      </View>
      <SeriesScrubber
        points={samples}
        accent={accent}
        height={HEIGHT}
        label={series.label}
        format={format}
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
                  height: 6 + ((point.value - summary.min) / summary.range) * (HEIGHT - 14),
                  backgroundColor: `${accent}26`,
                  borderTopColor: accent,
                },
              ]}
            />
          ))}
        </View>
      </SeriesScrubber>
      <ColourStrip spans={spans} totalKm={totalKm} />
      <View style={styles.footer}>
        <Text style={styles.axisText}>0 km</Text>
        <Text style={styles.axisText}>{summary.distanceKm.toFixed(1)} km</Text>
      </View>
      <Legend entries={legend} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { color: COLOR.faint, fontSize: 10, fontVariant: ['tabular-nums'] },
  grid: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'space-evenly' },
  gridLine: { height: StyleSheet.hairlineWidth, backgroundColor: COLOR.line },
  columns: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, borderTopWidth: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
});
