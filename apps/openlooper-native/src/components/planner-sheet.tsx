import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ACTIVITY, CREATION_MODES, type PlannerState } from '@/domain/models';
import type { PlannerAction } from '@/state/planner';

type Props = {
  state: PlannerState;
  notice: string;
  dispatch: React.Dispatch<PlannerAction>;
  onSearch: (query: string) => void;
  onRoute: () => void;
};

export function PlannerSheet({ state, notice, dispatch, onSearch, onRoute }: Props) {
  const [query, setQuery] = useState('');
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 800;
  const accent = ACTIVITY[state.activity].color;

  const sketchHint = state.sketchCompleted
    ? 'Sketch complete. Add-point editing and route dragging come next.'
    : state.waypoints.length < 2
      ? 'Tap the map to place a start and endpoint.'
      : 'Keep tapping to extend. Tap A to close or B to finish A → B.';

  return (
    <View
      style={[
        styles.sheet,
        desktop ? styles.sheetDesktop : styles.sheetMobile,
        !desktop && { paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      {!desktop && <View style={styles.handle} />}
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>OPENLOOPER</Text>
        <Text style={styles.title}>Make a route worth taking</Text>

        <View style={styles.searchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => onSearch(query)}
            placeholder="Find a place"
            placeholderTextColor="#7b857d"
            returnKeyType="search"
            style={styles.searchInput}
            accessibilityLabel="Find a place"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => onSearch(query)}
            style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        <View style={styles.segmented} accessibilityRole="radiogroup">
          {(Object.keys(ACTIVITY) as Array<keyof typeof ACTIVITY>).map((activity) => (
            <Pressable
              key={activity}
              accessibilityRole="radio"
              accessibilityState={{ checked: state.activity === activity }}
              onPress={() => dispatch({ type: 'activity', activity })}
              style={[
                styles.segment,
                state.activity === activity && styles.segmentSelected,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  state.activity === activity && { color: accent },
                ]}
              >
                {ACTIVITY[activity].label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.segmented} accessibilityRole="radiogroup">
          {CREATION_MODES.map((mode) => (
            <Pressable
              key={mode.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: state.mode === mode.value }}
              onPress={() => dispatch({ type: 'mode', mode: mode.value })}
              style={[
                styles.segment,
                state.mode === mode.value && styles.segmentSelected,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  state.mode === mode.value && { color: accent },
                ]}
              >
                {mode.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {state.mode === 'pointToPoint' && (
          <View style={styles.toolRow}>
            {(['start', 'destination', 'add'] as const).map((tool) => (
              <Pressable
                key={tool}
                onPress={() => dispatch({ type: 'tool', tool })}
                style={[
                  styles.toolButton,
                  state.activeTool === tool && { borderColor: accent, backgroundColor: '#fff7f3' },
                ]}
              >
                <Text style={styles.toolText}>
                  {tool === 'start' ? 'Set start' : tool === 'destination' ? 'Set finish' : 'Add point'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {state.mode === 'loop' && (
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Target distance</Text>
            <View style={styles.distanceInputWrap}>
              <TextInput
                value={String(state.targetDistanceKm)}
                onChangeText={(value) =>
                  dispatch({ type: 'target', distanceKm: Number(value) })
                }
                keyboardType="decimal-pad"
                style={styles.distanceInput}
                accessibilityLabel="Target distance in kilometres"
              />
              <Text style={styles.unit}>km</Text>
            </View>
          </View>
        )}

        <Text style={styles.hint}>
          {state.mode === 'sketch'
            ? sketchHint
            : state.mode === 'loop'
              ? 'Choose a start on the map, then generate candidate loops.'
              : 'Select a tool, then tap the map.'}
        </Text>

        {state.waypoints.length > 0 && (
          <View style={styles.pointsPanel}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Points</Text>
              <Pressable onPress={() => dispatch({ type: 'clear' })} hitSlop={10}>
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            </View>
            {state.waypoints.map((point, index) => (
              <View key={point.id} style={styles.pointRow}>
                <View
                  style={[
                    styles.pointDot,
                    {
                      backgroundColor:
                        point.role === 'start'
                          ? '#177657'
                          : point.role === 'destination'
                            ? '#b83c34'
                            : '#273f78',
                    },
                  ]}
                >
                  <Text style={styles.pointDotText}>{index + 1}</Text>
                </View>
                <Text style={styles.pointLabel}>
                  {point.role === 'start'
                    ? 'Start'
                    : point.role === 'destination'
                      ? 'Current endpoint'
                      : 'Via point'}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pressable
          onPress={onRoute}
          disabled={!state.waypoints.length}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: accent },
            !state.waypoints.length && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryText}>
            {state.mode === 'loop' ? 'Generate loops' : 'Preview route migration'}
          </Text>
        </Pressable>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
          <Text style={styles.platformText}>
            {Platform.OS === 'web' ? 'Leaflet web' : 'Native maps'} · Expo SDK 57
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    overflow: 'hidden',
    borderColor: 'rgba(23,32,25,0.12)',
    backgroundColor: 'rgba(250,251,247,0.97)',
    shadowColor: '#202d23',
    shadowOpacity: 0.2,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
  },
  sheetDesktop: {
    top: 12,
    bottom: 12,
    left: 12,
    width: 390,
    borderWidth: 1,
    borderRadius: 24,
  },
  sheetMobile: {
    right: 0,
    bottom: 0,
    left: 0,
    maxHeight: '58%',
    borderTopWidth: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    marginTop: 8,
    borderRadius: 3,
    backgroundColor: '#c1c8c0',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 12,
  },
  eyebrow: {
    color: '#68736b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    color: '#172019',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 13,
    borderWidth: 1,
    borderColor: 'rgba(23,32,25,0.12)',
    borderRadius: 12,
    backgroundColor: '#fff',
    color: '#172019',
  },
  searchButton: {
    minWidth: 82,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#172019',
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  segmented: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 13,
    backgroundColor: '#e8ece5',
  },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  segmentSelected: {
    backgroundColor: '#fff',
    shadowColor: '#203025',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  segmentText: {
    color: '#172019',
    fontSize: 13,
    fontWeight: '800',
  },
  toolRow: {
    flexDirection: 'row',
    gap: 7,
  },
  toolButton: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(23,32,25,0.12)',
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  toolText: {
    color: '#172019',
    fontSize: 11,
    fontWeight: '700',
  },
  fieldRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    color: '#172019',
    fontWeight: '800',
  },
  distanceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(23,32,25,0.12)',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingRight: 10,
  },
  distanceInput: {
    width: 55,
    minHeight: 40,
    paddingHorizontal: 10,
    color: '#172019',
    fontSize: 18,
    fontWeight: '900',
  },
  unit: {
    color: '#68736b',
  },
  hint: {
    color: '#68736b',
    fontSize: 12,
    lineHeight: 18,
  },
  pointsPanel: {
    gap: 7,
    paddingTop: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#172019',
    fontSize: 14,
    fontWeight: '900',
  },
  clearText: {
    color: '#9e2636',
    fontSize: 12,
    fontWeight: '800',
  },
  pointRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  pointDot: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  pointDotText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
  },
  pointLabel: {
    color: '#172019',
    fontSize: 13,
  },
  primary: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '900',
  },
  notice: {
    gap: 5,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#eef2e8',
  },
  noticeText: {
    color: '#48544c',
    fontSize: 12,
    lineHeight: 17,
  },
  platformText: {
    color: '#68736b',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  pressed: {
    opacity: 0.72,
  },
  disabled: {
    opacity: 0.38,
  },
});
