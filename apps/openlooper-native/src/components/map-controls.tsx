import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { COLOR, RADIUS, SHADOW } from '@/theme';
import { OVERLAY_LABEL, type LegendEntry } from '../../../../src/domain/route-overlays';
import { distanceUnit, type UnitSystem } from '../../../../src/domain/units';
import {
  MAP_STYLES,
  type InteractionMode,
  type MapStyleId,
  type RouteOverlay,
  type ViewportEvidenceState,
} from '@/domain/models';
import { GlassSurface } from './ui/glass-surface';
import { IconButton } from './ui/icon-button';

const OVERLAYS: RouteOverlay[] = ['route', 'gradient', 'surface', 'roads', 'usage', 'speed'];
/** The same purple the recorded-use colouring uses, so the underlay and the
 * route colouring plainly come from one source. */
const EVIDENCE_COLOR = '#6846a5';
/** Height the legend strip occupies, so the buttons can sit clear of it. */
const BAR_HEIGHT = 38;

export type MapControlsProps = {
  accent: string;
  mapStyle: MapStyleId;
  overlay: RouteOverlay;
  /** Key to the active colouring, shown on the map while it is not the default. */
  legend: LegendEntry[];
  /** Sheet height, so the controls ride above the sheet as it is dragged. */
  offset: SharedValue<number>;
  gap: number;
  /** Sheet height at which the controls have faded out behind the sheet. */
  fadeAt: number;
  /** How far in the left column starts, so it stands clear of the desktop
   * panel rather than sitting underneath it. */
  leftInset: number;
  locating: boolean;
  hasRoute: boolean;
  /** Whether there is an edit to step back from, or forward to. */
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** How far apart the distance marks are, in the planner's units. Absent when
   * the route is too short to mark, or a colouring is being read instead. */
  markSpacing?: number;
  units: UnitSystem;
  /** Recorded use drawn under the map while planning. */
  underlay: boolean;
  underlayStatus: ViewportEvidenceState;
  onUnderlay: () => void;
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
  legend,
  offset,
  gap,
  fadeAt,
  leftInset,
  locating,
  hasRoute,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  markSpacing,
  units,
  underlay,
  underlayStatus,
  onUnderlay,
  interaction,
  onInteraction,
  onMapStyle,
  onOverlay,
  onLocate,
  onFitRoute,
}: MapControlsProps) {
  const [open, setOpen] = useState<'style' | 'overlay' | undefined>();
  const editing = interaction === 'edit';

  // Everything that explains what is on the map, in one strip. Stacked as cards
  // they ate the map from the bottom up and pushed the controls off the top of a
  // phone; in a row they read left to right and scroll if there is more than
  // fits.
  const keys: LegendItem[] = [];
  if (underlay)
    keys.push({ key: 'underlay', color: EVIDENCE_COLOR, label: underlayLabel(underlayStatus) });
  if (markSpacing)
    keys.push({ key: 'marks', mark: String(markSpacing), label: markLegend(markSpacing, units) });
  if (hasRoute && overlay !== 'route' && open !== 'overlay')
    for (const entry of legend)
      keys.push({ key: `${overlay}-${entry.label}`, color: entry.color, label: entry.label });
  // The buttons ride above the strip rather than behind it.
  const columnGap = keys.length ? gap + BAR_HEIGHT + 8 : gap;

  return (
    <>
      <FloatingColumn side="left" offset={offset} gap={columnGap} fadeAt={fadeAt} inset={leftInset}>
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
        <IconButton
          symbol="figure.walk.motion"
          fallbackLabel="Used"
          accessibilityLabel={
            underlay
              ? 'Hide where routes are recorded as used'
              : 'Show where routes are recorded as used'
          }
          accent={underlay ? EVIDENCE_COLOR : accent}
          active={underlay}
          size={44}
          onPress={onUnderlay}
        />
        {/* Undo sits on the map because that is where the edits are made, and
            it stays out of the way until there is something to step back from. */}
        {editing && (canUndo || canRedo) && (
          <View style={styles.history}>
            <IconButton
              symbol="arrow.uturn.backward"
              fallbackLabel="Undo"
              accessibilityLabel="Undo the last change to this route"
              accent={accent}
              disabled={!canUndo}
              size={44}
              onPress={onUndo}
            />
            {canRedo && (
              <IconButton
                symbol="arrow.uturn.forward"
                fallbackLabel="Redo"
                accessibilityLabel="Redo the change that was undone"
                accent={accent}
                size={44}
                onPress={onRedo}
              />
            )}
          </View>
        )}
      </FloatingColumn>

      <FloatingColumn side="right" offset={offset} gap={columnGap} fadeAt={fadeAt} inset={14}>
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
          // One control with one meaning: editing is either on or it is not.
          // Swapping the symbol as well made it read as two different buttons.
          symbol="pencil"
          fallbackLabel="Edit"
          accessibilityLabel={
            editing
              ? 'Editing the route. Switch to inspecting.'
              : 'Inspecting the route. Switch to editing.'
          }
          accent={editing ? accent : COLOR.muted}
          active={editing}
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

      {!!keys.length && (
        <LegendBar
          offset={offset}
          gap={gap}
          fadeAt={fadeAt}
          inset={leftInset}
          overlay={hasRoute && overlay !== 'route' && open !== 'overlay' ? overlay : undefined}
          items={keys}
        />
      )}
    </>
  );
}

type LegendItem = { key: string; label: string; color?: string; mark?: string };

/**
 * The key to whatever the map is showing, laid across the bottom just above the
 * sheet. It scrolls sideways rather than wrapping, so a colouring with many
 * bands takes the same slice of map as one with two.
 */
function LegendBar({
  offset,
  gap,
  fadeAt,
  inset,
  overlay,
  items,
}: {
  offset: SharedValue<number>;
  gap: number;
  fadeAt: number;
  inset: number;
  overlay?: RouteOverlay;
  items: LegendItem[];
}) {
  const position = useAnimatedStyle(() => ({
    bottom: offset.value + gap,
    opacity: interpolate(offset.value, [fadeAt * 0.86, fadeAt], [1, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.bar, { left: inset, right: 14 }, position]}
    >
      <GlassSurface variant="regular" style={[styles.barSurface, SHADOW.floating]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.barRow}
        >
          {!!overlay && <Text style={styles.legendTitle}>{OVERLAY_LABEL[overlay].toUpperCase()}</Text>}
          {items.map((item) => (
            <View key={item.key} style={styles.legendRow}>
              {item.mark ? (
                <View style={styles.markSwatch}>
                  <Text style={styles.markSwatchText}>{item.mark}</Text>
                </View>
              ) : (
                <View style={[styles.swatch, { backgroundColor: item.color }]} />
              )}
              <Text style={styles.legendText} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          ))}
        </ScrollView>
      </GlassSurface>
    </Animated.View>
  );
}

/** What the numbered marks along the route are counting. */
function markLegend(spacing: number, units: UnitSystem): string {
  const unit = distanceUnit(units);
  return spacing === 1 ? `${unit} along the route` : `Every ${spacing} ${unit} along the route`;
}

function underlayLabel(status: ViewportEvidenceState): string {
  if (status.error) return status.error;
  if (status.loading) return 'Loading recorded use…';
  return status.count ? `${status.count} recorded sections` : 'No recorded use here';
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
  inset,
  children,
}: {
  side: 'left' | 'right';
  offset: SharedValue<number>;
  gap: number;
  fadeAt: number;
  inset: number;
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
      style={[
        side === 'left' ? styles.left : styles.right,
        side === 'left' ? { left: inset } : { right: inset },
        position,
      ]}
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
  left: { position: 'absolute', alignItems: 'flex-start', gap: 10 },
  history: { flexDirection: 'row', gap: 10 },
  markSwatch: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#2d3630',
    backgroundColor: '#fff',
  },
  markSwatchText: { color: '#2d3630', fontSize: 10, fontWeight: '800' },
  right: { position: 'absolute', alignItems: 'flex-end', gap: 10 },
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

  bar: { position: 'absolute' },
  barSurface: {
    height: BAR_HEIGHT,
    justifyContent: 'center',
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 13 },
  legendTitle: { color: COLOR.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 16, height: 4, borderRadius: 2 },
  legendText: { color: COLOR.ink, fontSize: 11, fontWeight: '600' },
});
