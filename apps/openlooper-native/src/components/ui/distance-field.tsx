import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { COLOR } from '@/theme';
import {
  distanceUnit,
  fromDistance,
  toDistance,
} from '../../../../../src/domain/units';
import { useUnits } from '@/state/settings-context';

/**
 * Keeps its own text while the planner types, so clearing the field leaves it
 * empty instead of snapping back to the clamped minimum. The target is held in
 * kilometres like every other distance, and only shown in the chosen unit.
 */
export function DistanceField({
  value,
  onChange,
}: {
  value: number;
  onChange: (km: number) => void;
}) {
  const units = useUnits();
  const shown = Math.round(toDistance(value, units) * 10) / 10;
  const [text, setText] = useState(String(shown));
  useEffect(() => {
    setText((current) => (Number(current) === shown ? current : String(shown)));
  }, [shown]);
  return (
    <View style={styles.wrap}>
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          const parsed = Number(next);
          if (next.trim() && Number.isFinite(parsed) && parsed >= 1)
            onChange(fromDistance(parsed, units));
        }}
        onBlur={() => setText(String(shown))}
        keyboardType="decimal-pad"
        selectTextOnFocus
        returnKeyType="done"
        style={styles.input}
        accessibilityLabel={`Target distance in ${units === 'imperial' ? 'miles' : 'kilometres'}`}
      />
      <Text style={styles.unit}>{distanceUnit(units)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  input: {
    width: 66,
    minHeight: 40,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#ccd2cb',
    borderRadius: 9,
    backgroundColor: COLOR.raised,
    color: COLOR.ink,
    fontSize: 17,
    fontWeight: '900',
  },
  unit: { color: COLOR.faint, fontSize: 11 },
});
