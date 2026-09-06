import { StyleSheet, Text, View } from 'react-native';

import { COLOR } from '@/theme';
import type { LegendEntry } from '../../../../../src/domain/route-overlays';

export function Legend({ entries }: { entries: LegendEntry[] }) {
  if (!entries.length) return null;
  return (
    <View style={styles.legend}>
      {entries.map((entry) => (
        <View key={entry.label} style={styles.item}>
          <View style={[styles.swatch, { backgroundColor: entry.color }]} />
          <Text style={styles.text}>{entry.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { gap: 5 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 22, height: 5, borderRadius: 3 },
  text: { color: COLOR.ink, fontSize: 12 },
});
