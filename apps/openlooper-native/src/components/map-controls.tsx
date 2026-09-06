import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { MAP_STYLES, type MapStyleId } from '@/domain/models';
import { GlassSurface } from './ui/glass-surface';
import { IconButton } from './ui/icon-button';

export type MapControlsProps = {
  accent: string;
  mapStyle: MapStyleId;
  /** Sheet height, so the column rides above the sheet as it is dragged. */
  offset: SharedValue<number>;
  gap: number;
  /** Highest the column rides; past this the sheet simply covers it. */
  maxOffset: number;
  locating: boolean;
  hasRoute: boolean;
  onMapStyle: (style: MapStyleId) => void;
  onLocate: () => void;
  onFitRoute: () => void;
};

/** Floating column at the bottom right of the map. */
export function MapControls({
  accent,
  mapStyle,
  offset,
  gap,
  maxOffset,
  locating,
  hasRoute,
  onMapStyle,
  onLocate,
  onFitRoute,
}: MapControlsProps) {
  const [stylesOpen, setStylesOpen] = useState(false);
  const position = useAnimatedStyle(() => ({
    bottom: Math.min(offset.value + gap, maxOffset),
  }));

  return (
    <Animated.View pointerEvents="box-none" style={[styles.column, position]}>
      {stylesOpen && (
        <GlassSurface variant="regular" style={styles.picker}>
          {MAP_STYLES.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === mapStyle }}
              onPress={() => {
                onMapStyle(option.value);
                setStylesOpen(false);
              }}
              style={[styles.option, option.value === mapStyle && { backgroundColor: accent }]}
            >
              <Text
                style={[styles.optionText, option.value === mapStyle && styles.optionTextActive]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </GlassSurface>
      )}
      <IconButton
        symbol="map"
        fallbackLabel="Map"
        accessibilityLabel="Change the base map"
        accent={accent}
        active={stylesOpen}
        size={44}
        onPress={() => setStylesOpen((open) => !open)}
      />
      {hasRoute && (
        <IconButton
          symbol="arrow.up.left.and.arrow.down.right"
          fallbackLabel="Fit"
          accessibilityLabel="Fit the route on screen"
          accent={accent}
          size={44}
          onPress={onFitRoute}
        />
      )}
      <IconButton
        symbol="location.fill"
        fallbackLabel="Here"
        accessibilityLabel="Start the route at my location"
        accent={accent}
        disabled={locating}
        size={54}
        onPress={onLocate}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: { position: 'absolute', right: 14, alignItems: 'flex-end', gap: 10 },
  picker: {
    gap: 3,
    padding: 5,
    borderRadius: RADIUS.panel,
    overflow: 'hidden',
    ...SHADOW.floating,
  },
  option: { minWidth: 108, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 },
  optionText: { color: COLOR.ink, fontSize: 13, fontWeight: '700' },
  optionTextActive: { color: '#fff', fontWeight: '900' },
});
