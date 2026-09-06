import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { OVERLAY_LABEL } from '../../../../src/domain/route-overlays';
import {
  MAP_STYLES,
  type InteractionMode,
  type MapStyleId,
  type RouteOverlay,
} from '@/domain/models';
import { GlassSurface } from './ui/glass-surface';
import { IconButton } from './ui/icon-button';

const OVERLAYS: RouteOverlay[] = ['route', 'gradient', 'surface', 'roads', 'usage', 'speed'];

export type MapControlsProps = {
  accent: string;
  mapStyle: MapStyleId;
  overlay: RouteOverlay;
  /** Sheet height, so the controls ride above the sheet as it is dragged. */
  offset: SharedValue<number>;
  gap: number;
  /** Sheet height at which the controls have faded out behind the sheet. */
  fadeAt: number;
  locating: boolean;
  hasRoute: boolean;
  interaction: InteractionMode;
  onInteraction: (interaction: InteractionMode) => void;
  onMapStyle: (style: MapStyleId) => void;
  onOverlay: (overlay: RouteOverlay) => void;
  onLocate: () => void;
  onFitRoute: () => void;
};

/** Floating controls that sit on the map either side of the sheet's top edge. */
export function MapControls({
  accent,
  mapStyle,
  overlay,
  offset,
  gap,
  fadeAt,
  locating,
  hasRoute,
  interaction,
  onInteraction,
  onMapStyle,
  onOverlay,
  onLocate,
  onFitRoute,
}: MapControlsProps) {
  const [open, setOpen] = useState<'style' | 'overlay' | undefined>();
  const editing = interaction === 'edit';

  return (
    <>
      <FloatingColumn side="left" offset={offset} gap={gap} fadeAt={fadeAt}>
        {open === 'overlay' && (
          <OptionPicker
            accent={accent}
            selected={overlay}
            options={OVERLAYS.map((value) => ({ value, label: OVERLAY_LABEL[value] }))}
            onSelect={(value) => {
              onOverlay(value);
              setOpen(undefined);
            }}
          />
        )}
        {hasRoute && (
          <IconButton
            symbol="eye"
            fallbackLabel="Colour"
            accessibilityLabel="Choose what the route is coloured by"
            accent={accent}
            active={open === 'overlay'}
            size={44}
            onPress={() => setOpen((current) => (current === 'overlay' ? undefined : 'overlay'))}
          />
        )}
      </FloatingColumn>

      <FloatingColumn side="right" offset={offset} gap={gap} fadeAt={fadeAt}>
        {open === 'style' && (
          <OptionPicker
            accent={accent}
            selected={mapStyle}
            options={MAP_STYLES.map((item) => ({ value: item.value, label: item.label }))}
            onSelect={(value) => {
              onMapStyle(value);
              setOpen(undefined);
            }}
          />
        )}
        <IconButton
          symbol="map"
          fallbackLabel="Map"
          accessibilityLabel="Change the base map"
          accent={accent}
          active={open === 'style'}
          size={44}
          onPress={() => setOpen((current) => (current === 'style' ? undefined : 'style'))}
        />
        <IconButton
          symbol={editing ? 'pencil' : 'magnifyingglass'}
          fallbackLabel={editing ? 'Edit' : 'View'}
          accessibilityLabel={
            editing
              ? 'Editing the route. Switch to inspecting.'
              : 'Inspecting the route. Switch to editing.'
          }
          // Filled in both modes, so the control still reads as the mode switch
          // once it is no longer showing the pencil.
          accent={editing ? accent : COLOR.ink}
          active
          size={44}
          onPress={() => onInteraction(editing ? 'inspect' : 'edit')}
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
      </FloatingColumn>
    </>
  );
}

/**
 * One side's stack of controls, riding above the sheet. Each column owns its own
 * animated style: a style object holds a single set of view descriptors, so
 * sharing one between two views leaves one of them unpositioned.
 */
function FloatingColumn({
  side,
  offset,
  gap,
  fadeAt,
  children,
}: {
  side: 'left' | 'right';
  offset: SharedValue<number>;
  gap: number;
  fadeAt: number;
  children: ReactNode;
}) {
  const position = useAnimatedStyle(() => ({
    bottom: offset.value + gap,
    // A nearly full sheet leaves no map to control, so the buttons fade out
    // rather than crowding the top of the screen.
    opacity: interpolate(offset.value, [fadeAt * 0.86, fadeAt], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[side === 'left' ? styles.left : styles.right, position]}
    >
      {children}
    </Animated.View>
  );
}

function OptionPicker<T extends string>({
  options,
  selected,
  accent,
  onSelect,
}: {
  options: { value: T; label: string }[];
  selected: T;
  accent: string;
  onSelect: (value: T) => void;
}) {
  return (
    <GlassSurface variant="regular" style={styles.picker}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: option.value === selected }}
          onPress={() => onSelect(option.value)}
          style={[styles.option, option.value === selected && { backgroundColor: accent }]}
        >
          <Text
            numberOfLines={1}
            style={[styles.optionText, option.value === selected && styles.optionTextActive]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  left: { position: 'absolute', left: 14, alignItems: 'flex-start', gap: 10 },
  right: { position: 'absolute', right: 14, alignItems: 'flex-end', gap: 10 },
  // Two columns so an open picker cannot push the buttons off the top of a
  // phone screen when the sheet is already high.
  picker: {
    width: 196,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    padding: 5,
    borderRadius: RADIUS.panel,
    overflow: 'hidden',
    ...SHADOW.floating,
  },
  option: { width: 91, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 9 },
  optionText: { color: COLOR.ink, fontSize: 12, fontWeight: '700' },
  optionTextActive: { color: '#fff', fontWeight: '900' },
});
