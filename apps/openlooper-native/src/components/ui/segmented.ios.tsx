import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { labelsHidden, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';

import type { SegmentedProps } from './types';

/** Real `UISegmentedControl`, so it picks up the system's glass styling. */
export function Segmented<T extends string>({
  values,
  selected,
  accent,
  onChange,
  accessibilityLabel = 'Options',
}: SegmentedProps<T>) {
  return (
    <Host style={styles.host} seedColor={accent} colorScheme="light">
      <Picker
        label={accessibilityLabel}
        selection={selected}
        onSelectionChange={(value) => {
          // SwiftUI echoes the current selection back on mount; ignore no-ops so
          // the planner does not re-route on every render.
          if (value != null && value !== selected) onChange(value as T);
        }}
        modifiers={[pickerStyle('segmented'), labelsHidden()]}
      >
        {values.map((item) => (
          <Text key={item.value} modifiers={[tag(item.value)]}>
            {item.label}
          </Text>
        ))}
      </Picker>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { height: 34 },
});
