import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { COLOR } from '@/theme';

/**
 * Keeps its own text while the planner types, so clearing the field leaves it
 * empty instead of snapping back to the clamped minimum.
 */
export function DistanceField({
  value,
  onChange,
}: {
  value: number;
  onChange: (km: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);
  return (
    <View style={styles.wrap}>
      <TextInput
        value={text}
        onChangeText={(next) => {
          setText(next);
          const parsed = Number(next);
          if (next.trim() && Number.isFinite(parsed) && parsed >= 1) onChange(parsed);
        }}
        onBlur={() => setText(String(value))}
        keyboardType="decimal-pad"
        selectTextOnFocus
        returnKeyType="done"
        style={styles.input}
        accessibilityLabel="Target distance in kilometres"
      />
      <Text style={styles.unit}>km</Text>
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
