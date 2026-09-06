import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COLOR, RADIUS } from '@/theme';
import type { SegmentedProps } from './types';

/** Android/web stand-in for the iOS segmented picker. */
export function Segmented<T extends string>({
  values,
  selected,
  accent,
  onChange,
  accessibilityLabel,
}: SegmentedProps<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} style={styles.track}>
      {values.map((item) => (
        <Pressable
          key={item.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: selected === item.value }}
          onPress={() => onChange(item.value)}
          style={[styles.segment, selected === item.value && styles.selected]}
        >
          <Text style={[styles.text, selected === item.value && { color: accent }]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, borderRadius: RADIUS.control, backgroundColor: COLOR.field },
  segment: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  selected: { backgroundColor: COLOR.raised },
  text: { color: COLOR.ink, fontSize: 13, fontWeight: '800' },
});
