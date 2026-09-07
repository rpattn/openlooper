import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { labelsHidden, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet, View } from 'react-native';

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
    // The wrapper reserves the row outright, so React Native's layout never
    // waits on SwiftUI to report a size; and the hosting view is told to ignore
    // the container safe area, which otherwise lifts the control off its own
    // frame when it sits in the home-indicator strip at the bottom of a screen.
    <View style={styles.row}>
      <Host
        style={styles.host}
        seedColor={accent}
        colorScheme="light"
        ignoreSafeArea="container"
      >
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
    </View>
  );
}

const ROW_HEIGHT = 34;

const styles = StyleSheet.create({
  row: { height: ROW_HEIGHT },
  host: { flex: 1 },
});
