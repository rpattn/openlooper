import Slider from '@react-native-community/slider';
import { useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SharedValue } from 'react-native-reanimated';

import { DEFAULT_LOOP_SCORING_WEIGHTS } from '../../../../src/domain/route-scoring';
import {
  formatDistance,
  formatElevation,
  formatShortDistance,
} from '../../../../src/domain/units';
import {
  characterPreferenceHint,
  cycleLaneName,
  roadClassName,
  sidewalkName,
  surfaceName,
  travelModeName,
  useName,
} from '../../../../src/domain/vocabulary';
import { OVERLAY_LABEL } from '../../../../src/domain/route-overlays';
import type { ColourSpan, LegendEntry } from '../../../../src/domain/route-overlays';
import type { RouteSeries } from '../../../../src/domain/route-series';
import type { SurfaceTolerance } from '../../../../src/domain/models';
import { COLOR, RADIUS, SHADOW } from '@/theme';
import { ACTIVITY, CREATION_MODES } from '@/domain/models';
import { NOMINATIM_URL } from '@/services/endpoints';
import type { UnitSystem } from '../../../../src/domain/units';
import type {
  Coordinate,
  LoopScoringWeights,
  PlannerState,
  RouteIssue,
  RouteEdge,
  RouteOverlay,
  RoutingPreferences,
  Waypoint,
} from '@/domain/models';
import { legDistances } from '@/domain/route-positions';
import { useUnits } from '@/state/settings-context';
import { editableWaypoints, waypointLabel, waypointMarker } from '@/domain/waypoints';
import { DragSheet } from './drag-sheet';
import { PrimaryButton, SmallButton } from './ui/buttons';
import { Collapsible } from './ui/collapsible';
import { DistanceField } from './ui/distance-field';
import { ProfileChart } from './ui/profile-chart';
import { Segmented } from './ui/segmented';
import { WaypointList } from './ui/waypoint-list';
import type { WaypointRow } from './ui/types';

type Props = {
  state: PlannerState;
  scoringWeights: LoopScoringWeights;
  evidenceRanking: boolean;
  sheetHeight: SharedValue<number>;
  onEvidenceRanking: (enabled: boolean) => void;
  onScoringWeights: (weights: LoopScoringWeights) => void;
  onPreferences: (preferences: RoutingPreferences) => void;
  onTool: (tool: PlannerState['activeTool']) => void;
  onTarget: (km: number) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
  onSelectAlternative: (id: string) => void;
  onReverse: () => void;
  /** Turns the route round on itself: out as planned, back the way it came. */
  onOutAndBack: () => void;
  /** Replaces the editable waypoints after a reorder, removal or reversal. */
  onWaypoints: (points: Waypoint[]) => void;
  onClear: () => void;
  onIssue: (issue: RouteIssue) => void;
  onEdgeDismiss: () => void;
  onProfile: (coordinate?: Coordinate, distanceKm?: number) => void;
  onSheet: (sheet: PlannerState['sheet']) => void;
  /** Switches what the route is coloured by, and so what the chart plots. */
  onOverlay: (overlay: RouteOverlay) => void;
  /** Pulling the collapsed sheet down leaves the route. */
  onDismiss: () => void;
  onSearchSelect: (coordinate: Coordinate) => void;
  /** Centres the map on a point picked from the list. */
  onFocusPoint: (coordinate: Coordinate) => void;
  /** What the profile chart plots, chosen by the active route colouring. */
  series: RouteSeries;
  /** The same colouring the map drew, laid out along the distance axis. */
  spans: ColourSpan[];
  legend: LegendEntry[];
  overlayUnavailable?: string;
  onExport: () => void;
};

type SearchResult = { place_id: number; display_name: string; lat: string; lon: string };
const SEARCH_ENDPOINT = NOMINATIM_URL;
const LOOP_TOOLS = [
  { value: 'start', label: 'Move start' },
  { value: 'add', label: 'Add loop point' },
] as const;
const POINT_TOOLS = [
  { value: 'start', label: 'Start' },
  { value: 'destination', label: 'Finish' },
  { value: 'add', label: 'Add point' },
] as const;
const OVERLAYS: RouteOverlay[] = ['route', 'gradient', 'surface', 'roads', 'usage', 'speed'];
/** Where the desktop panel sits. The map controls read this so they stand clear
 * of it rather than being buried underneath. */
export const DESKTOP_PANEL = { left: 12, width: 410, gap: 14 } as const;
let lastSearch = 0;

export function PlannerSheet(props: Props) {
  const { state } = props;
  const units = useUnits();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 800;
  const editing = state.interaction === 'edit';
  const accent = ACTIVITY[state.plan.activity].color;

  function search() {
    const value = query.trim();
    if (!value) return;
    setSearching(true);
    setSearchError('');
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        lastSearch = Date.now();
        const params = new URLSearchParams({ q: value, format: 'jsonv2', limit: '5' });
        const spanLat = 90 / 2 ** state.camera.zoom;
        const spanLon = 180 / 2 ** state.camera.zoom;
        params.set('viewbox', [
          state.camera.center.lon - spanLon,
          state.camera.center.lat + spanLat,
          state.camera.center.lon + spanLon,
          state.camera.center.lat - spanLat,
        ].join(','));
        const response = await fetch(`${SEARCH_ENDPOINT}/search?${params}`, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error();
        const found = (await response.json()) as SearchResult[];
        setResults(found);
        if (!found.length) setSearchError('No places found. Choose a point on the map instead.');
      } catch {
        setSearchError('Search is unavailable. Choose a point on the map instead.');
      } finally {
        setSearching(false);
      }
    }, Math.max(0, 1000 - (Date.now() - lastSearch)));
  }

  const peek = <Peek state={state} accent={accent} units={units} />;

  const body = (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      // Keeps whatever is being typed into clear of the keyboard.
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
          // At any smaller detent the keyboard covers the whole sheet, this
          // field included, so typing starts by opening the sheet fully.
          onFocus={() => props.onSheet('full')}
          placeholder="Find a place"
          placeholderTextColor={COLOR.faint}
          returnKeyType="search"
          style={styles.searchInput}
          accessibilityLabel="Find a place"
        />
        <SmallButton label={searching ? '…' : 'Search'} onPress={search} dark />
      </View>
      {!!searchError && <Notice text={searchError} error />}
      {results.map((result) => (
        <Pressable
          key={result.place_id}
          style={styles.searchResult}
          onPress={() => {
            props.onSearchSelect({ lat: Number(result.lat), lon: Number(result.lon) });
            setResults([]);
          }}
        >
          <Text style={styles.searchResultText}>{result.display_name}</Text>
        </Pressable>
      ))}

      {editing && state.plan.mode === 'pointToPoint' && (
        <Segmented
          accessibilityLabel="Map tap places"
          values={POINT_TOOLS}
          selected={state.activeTool}
          accent={accent}
          onChange={props.onTool}
        />
      )}
      {editing && state.plan.mode === 'loop' && !!state.plan.waypoints.length && (
        <Segmented
          accessibilityLabel="Map tap places"
          values={LOOP_TOOLS}
          selected={state.activeTool === 'add' ? 'add' : 'start'}
          accent={accent}
          onChange={props.onTool}
        />
      )}
      {editing && state.plan.mode === 'sketch' && state.sketchCompleted && (
        <ChoiceButton
          selected={state.activeTool === 'add'}
          accent={accent}
          onPress={() => props.onTool('add')}
          label="Add point"
        />
      )}

      {state.plan.mode === 'loop' && (
        <View style={styles.panel}>
          <View style={styles.fieldRow}>
            <Text style={styles.label}>Target distance</Text>
            <DistanceField value={state.plan.targetDistanceKm ?? 10} onChange={props.onTarget} />
          </View>
          <PrimaryButton
            accent={accent}
            disabled={!state.plan.waypoints.length || state.loading}
            label={state.alternatives.length ? 'Generate loops' : 'Find loops'}
            onPress={props.onGenerate}
          />
          {!!state.alternatives.length && (
            <SmallButton label="Regenerate differently" onPress={props.onRegenerate} />
          )}
        </View>
      )}

      {/* What a tap does is worth saying once. After the first point it is
          plain from the map, and the prompt would be in the way. */}
      {editing && !state.plan.waypoints.length ? (
        <View style={[styles.prompt, { borderColor: accent }]}>
          <Text style={styles.promptTitle}>{firstTap(state)}</Text>
          <Text style={styles.hint}>
            Or press the location button on the map to start where you are.
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>{hint(state)}</Text>
      )}

      <PointsPanel {...props} accent={accent} />

      <View style={styles.panel}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Route preferences</Text>
          <Text style={styles.muted}>{preferenceSummary(state)}</Text>
        </View>
        <Preferences {...props} accent={accent} />
      </View>

      {__DEV__ && (
        <Collapsible title="Development · loop scoring" tone="dev">
          <DeveloperSettings {...props} accent={accent} />
        </Collapsible>
      )}

      {state.loading && (
        <Notice text={state.progress ?? 'Calculating route…'} action="Stop" onAction={props.onCancel} />
      )}
      {!!state.error && <Notice text={state.error} error />}

      {state.alternatives.length > 1 && (
        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>
            {state.plan.mode === 'loop' ? 'Loop choices' : 'Route choices'}
          </Text>
          {state.alternatives.map((alternative, index) => (
            <Pressable
              key={alternative.id}
              onPress={() => props.onSelectAlternative(alternative.id)}
              style={[
                styles.alternative,
                alternative.result.id === state.selectedRoute?.id && { borderColor: accent },
              ]}
            >
              <Text style={styles.alternativeTitle}>
                {String.fromCharCode(65 + index)} · {formatDistance(alternative.result.distanceKm, units)}
              </Text>
              <Text style={styles.hint}>{alternative.label}</Text>
              {__DEV__ && alternative.metrics && (
                <Text style={styles.scoreBreakdown}>
                  Distance −{alternative.metrics.distancePenaltyPoints.toFixed(1)} · Repetition −
                  {alternative.metrics.repetitionPenaltyPoints.toFixed(1)} · Geometry −
                  {alternative.metrics.geometryPenaltyPoints.toFixed(1)} · Issues −
                  {alternative.metrics.issuePenaltyPoints.toFixed(1)} · Character{' '}
                  {alternative.metrics.characterPoints >= 0 ? '+' : '−'}
                  {Math.abs(alternative.metrics.characterPoints).toFixed(1)} · Final{' '}
                  {alternative.metrics.score.toFixed(1)}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}

      {state.selectedRoute && (
        <>
          <View style={styles.summary}>
            <SummaryItem label="Distance" value={formatDistance(state.selectedRoute.distanceKm, units)} />
            <SummaryItem label="Time" value={duration(state.selectedRoute.durationSeconds)} />
            {state.selectedRoute.ascentM !== undefined && (
              <SummaryItem
                label="Elevation"
                value={`≈ ${formatElevation(state.selectedRoute.ascentM, units)} ↑ · ${formatElevation(state.selectedRoute.descentM ?? 0, units)} ↓`}
              />
            )}
            {state.selectedRoute.useEvidence && (
              <SummaryItem
                label="Use evidence"
                value={
                  state.selectedRoute.useEvidence.status === 'available'
                    ? `${Math.round(state.selectedRoute.useEvidence.evidencedDistancePct)}% of distance`
                    : 'Unavailable'
                }
              />
            )}
            <View style={styles.summaryAction}>
              <PrimaryButton accent={accent} label="Export GPX" onPress={props.onExport} />
            </View>
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{props.series.label} over distance</Text>
            {/* The same switch as the map's colour control, kept beside the chart
                so several readings of one route can be flicked through here. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.overlayRow}
            >
              {OVERLAYS.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: state.overlay === value }}
                  onPress={() => props.onOverlay(value)}
                  style={[
                    styles.overlayPill,
                    state.overlay === value && { backgroundColor: accent, borderColor: accent },
                  ]}
                >
                  <Text
                    style={[
                      styles.overlayPillText,
                      state.overlay === value && styles.overlayPillTextActive,
                    ]}
                  >
                    {OVERLAY_LABEL[value]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {props.series.points.length ? (
              <ProfileChart
                series={props.series}
                cursorKm={state.profileKm}
                spans={props.spans}
                totalKm={state.selectedRoute.distanceKm}
                legend={props.legend}
                accent={accent}
                onPoint={props.onProfile}
              />
            ) : (
              <Text style={styles.hint}>
                {props.series.label} is unavailable for this route.
              </Text>
            )}
            {!!props.overlayUnavailable && (
              <Text style={styles.hint}>{props.overlayUnavailable}</Text>
            )}
          </View>

          {state.highlightedEdgeIndex !== undefined &&
            state.selectedRoute.edges[state.highlightedEdgeIndex] && (
              <EdgeDetails
                edge={state.selectedRoute.edges[state.highlightedEdgeIndex]}
                units={units}
                onClose={props.onEdgeDismiss}
              />
            )}

          <Collapsible
            title="Route notes"
            forceOpen={!!state.highlightedIssueId}
            badge={
              !state.selectedRoute.edges.length
                ? 'attribution unavailable'
                : `${state.selectedRoute.issues.length} noted`
            }
          >
            {!state.selectedRoute.edges.length ? (
              <Text style={styles.hint}>
                Route-quality attribution is unavailable. Routing and elevation remain usable.
              </Text>
            ) : !state.selectedRoute.issues.length ? (
              <Text style={styles.hint}>
                No issues were identified from the available route attributes. This is not a safety
                guarantee.
              </Text>
            ) : (
              state.selectedRoute.issues.map((issue) => (
                <Issue
                  key={issue.id}
                  issue={issue}
                  selected={state.highlightedIssueId === issue.id}
                  units={units}
                  onPress={() => props.onIssue(issue)}
                />
              ))
            )}
            <Text style={styles.disclaimer}>
              Based on normalized route data. Not a guarantee of safety, accessibility, surface
              condition, traffic, lighting, or current hazards.
            </Text>
          </Collapsible>
        </>
      )}
    </ScrollView>
  );

  if (desktop) {
    return (
      <View style={[styles.desktop, SHADOW.sheet]}>
        <View style={styles.desktopHeader}>{peek}</View>
        {body}
      </View>
    );
  }

  return (
    <DragSheet
      snap={state.sheet}
      onSnap={props.onSheet}
      height={props.sheetHeight}
      bottomInset={insets.bottom}
      peek={peek}
      onDismiss={props.onDismiss}
    >
      {body}
    </DragSheet>
  );
}

function Peek({
  state,
  accent,
  units,
}: {
  state: PlannerState;
  accent: string;
  units: UnitSystem;
}) {
  const route = state.selectedRoute;
  const mode = CREATION_MODES.find((item) => item.value === state.plan.mode)?.label ?? '';
  const delta = distanceDelta(state, units);
  return (
    <View style={styles.peek}>
      <View style={styles.peekGrow}>
        <Text style={styles.eyebrow}>
          {ACTIVITY[state.plan.activity].label.toUpperCase()} · {mode.toUpperCase()}
        </Text>
        {/* An edit replaces the route, but blanking the numbers on every tap
            makes the one thing being watched flicker. The old reading stays,
            marked as being worked on, until the new one lands. */}
        <View style={styles.peekLine}>
          <Text style={styles.peekTitle} numberOfLines={1}>
            {route
              ? `${formatDistance(route.distanceKm, units)} · ${duration(route.durationSeconds)}`
              : state.loading
                ? 'Calculating route…'
                : 'Place your points on the map'}
          </Text>
          {!!route && state.loading && <Text style={styles.pending}>updating…</Text>}
          {!!route && !state.loading && !!delta && (
            <Text style={[styles.delta, { color: accent }]}>{delta}</Text>
          )}
        </View>
      </View>
      {state.sheet !== 'collapsed' && <View style={[styles.accentBar, { backgroundColor: accent }]} />}
    </View>
  );
}

function PointsPanel(props: Props & { accent: string }) {
  const { state, accent } = props;
  const units = useUnits();
  const editable = state.interaction === 'edit';
  const points = editableWaypoints(state);
  if (!points.length) return null;
  const loop = state.plan.mode === 'loop';

  // How far the route covers reaching each point from the one before it, which
  // reads a multi-point route as stages rather than as one total with pins in
  // it. Worked out from the geometry, because a routed plan comes back as a
  // single leg however many points shaped it.
  const legs = state.selectedRoute ? legDistances(state.selectedRoute, points, loop) : [];
  const rows: WaypointRow[] = points.map((point, index) => ({
    id: point.id,
    index,
    role: point.role,
    locked: loop && index === 0,
    title: waypointLabel(state.plan.mode, point.role, index),
    marker: waypointMarker(point.role, index),
    subtitle: `${point.coordinate.lat.toFixed(5)}, ${point.coordinate.lon.toFixed(5)}`,
    legKm: legs[index],
    legLabel: legs[index] === undefined ? undefined : formatShortDistance(legs[index]!, units),
  }));

  function move(from: number, to: number) {
    const lower = loop ? 1 : 0;
    const target = Math.max(lower, Math.min(points.length - 1, to));
    if (from === target || (loop && from === 0)) return;
    const next = [...points];
    const [moved] = next.splice(from, 1);
    next.splice(target, 0, moved!);
    props.onWaypoints(next);
  }

  function remove(index: number) {
    if (points.length <= 1 || (loop && index === 0)) return;
    props.onWaypoints(points.filter((_, position) => position !== index));
  }

  return (
    <View style={styles.panel}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Points · {points.length}</Text>
        {editable && (
          <View style={styles.buttonRow}>
            {!loop && points.length > 1 && (
              <>
                <SmallButton label="Reverse" onPress={props.onReverse} />
                <SmallButton label="Out & back" onPress={props.onOutAndBack} />
              </>
            )}
            <SmallButton label="Clear" onPress={props.onClear} />
          </View>
        )}
      </View>
      <WaypointList
        rows={rows}
        accent={accent}
        editable={editable}
        onMove={move}
        onDelete={remove}
        onSelect={(id) => {
          const point = points.find((item) => item.id === id);
          if (point) props.onFocusPoint(point.coordinate);
        }}
      />
      {editable && (
        <Text style={styles.disclaimer}>
          {loop
            ? 'Reorder, remove or drag loop points; the loop reroutes through them as you tune it.'
            : 'Reorder or remove points here. The route recalculates as you edit.'}
        </Text>
      )}
    </View>
  );
}

function Preferences(props: Props & { accent: string }) {
  const { state, accent } = props;
  const pref = state.plan.preferences;
  const tolerances: Array<{ value: SurfaceTolerance; label: string }> = [
    { value: 'paved', label: 'Paved only' },
    { value: 'firm', label: 'Firm paths too' },
    { value: 'any', label: 'Anything' },
  ];
  return (
    <>
      <PreferenceSlider
        label="Route character"
        value={pref.character}
        accent={accent}
        onChange={(character) => props.onPreferences({ ...pref, character })}
      />
      <View style={styles.scaleEnds}>
        <Text style={styles.scaleEnd}>Direct &amp; paved</Text>
        <Text style={styles.scaleEnd}>Green &amp; quiet</Text>
      </View>
      <Text style={styles.disclaimer}>{characterPreferenceHint(pref.character)}</Text>
      <Text style={styles.label}>Surface</Text>
      <View style={styles.choiceRow}>
        {tolerances.map((option) => (
          <ChoiceButton
            key={option.value}
            label={option.label}
            selected={pref.surfaceTolerance === option.value}
            accent={accent}
            onPress={() => props.onPreferences({ ...pref, surfaceTolerance: option.value })}
          />
        ))}
      </View>
      <Text style={styles.disclaimer}>
        What to route over. Recorded surfaces are incomplete, so this steers the route rather than
        guaranteeing what you will find.
      </Text>
      <PreferenceSlider
        label="Hills"
        value={pref.hillPreference}
        accent={accent}
        onChange={(hillPreference) => props.onPreferences({ ...pref, hillPreference })}
      />
      <View style={styles.scaleEnds}>
        <Text style={styles.scaleEnd}>Flattest</Text>
        <Text style={styles.scaleEnd}>Seek hills</Text>
      </View>
      <Text style={styles.label}>Avoid</Text>
      <Toggle
        label="Steps"
        value={pref.avoidSteps}
        onChange={(avoidSteps) => props.onPreferences({ ...pref, avoidSteps })}
      />
      {state.plan.activity !== 'cycle' && (
        <>
          <Toggle
            label="Unlit roads where recorded"
            value={pref.preferLit}
            onChange={(preferLit) => props.onPreferences({ ...pref, preferLit })}
          />
          <Text style={styles.disclaimer}>
            Lighting is recorded on about a tenth of local ways, and the ways that carry it are
            mostly main roads: preferring lit sections makes routes longer and busier.
          </Text>
        </>
      )}
    </>
  );
}

/**
 * What the last edit did to the distance. Worth saying because the number people
 * are steering towards is the one that moves, and by how much is the question a
 * fresh total does not answer on its own.
 */
function distanceDelta(state: PlannerState, units: UnitSystem): string | undefined {
  const before = state.previousDistanceKm;
  const now = state.selectedRoute?.distanceKm;
  if (before === undefined || now === undefined) return undefined;
  const change = now - before;
  if (Math.abs(change) < 0.05) return undefined;
  return `${change > 0 ? '+' : '−'}${formatDistance(Math.abs(change), units)}`;
}

/** The preferences in a phrase, so the panel says what it is set to while shut. */
function preferenceSummary(state: PlannerState): string {
  const pref = state.plan.preferences;
  const surface = { paved: 'paved only', firm: 'firm paths too', any: 'any surface' }[
    pref.surfaceTolerance
  ];
  return [
    characterPreferenceHint(pref.character).toLowerCase(),
    surface,
    pref.avoidSteps ? 'avoids steps' : 'steps allowed',
    `${Math.round(pref.hillPreference * 100)}% hills`,
  ].join(' · ');
}

/** What the very first tap on the map will do, in the words the tools use. */
function firstTap(state: PlannerState): string {
  if (state.plan.mode === 'sketch') return 'Tap the map to start sketching.';
  if (state.plan.mode === 'loop') return 'Tap the map to set where the loop starts.';
  return state.activeTool === 'destination'
    ? 'Tap the map to set your finish.'
    : 'Tap the map to set your start.';
}

function hint(state: PlannerState) {
  if (state.interaction === 'inspect')
    return 'Inspecting. Tap the route for segment details, or switch back to editing to change it.';
  if (state.plan.mode === 'sketch')
    return state.sketchCompleted
      ? 'Sketch complete. Add or drag points to edit the routed shape.'
      : state.plan.waypoints.length < 2
        ? 'Tap the map to place a start and endpoint.'
        : 'Keep tapping to extend. Tap A to close or the endpoint to finish.';
  if (state.plan.mode === 'loop') {
    if (!state.plan.waypoints.length)
      return 'Choose a start on the map, then generate up to three distinct routes.';
    if (state.loopTuned)
      return 'Tuning this loop. Drag, add or reorder points and it reroutes through them; generate again for a fresh shape.';
    return state.activeTool === 'add'
      ? 'Tap the map to add loop points the route must pass through, then generate.'
      : 'Tap the map to move the start, then generate up to three distinct routes.';
  }
  return 'Select a tool, tap the map, or drag the route line itself to reshape it.';
}

function DeveloperSettings(props: Props & { accent: string }) {
  const sliders: Array<{ key: keyof LoopScoringWeights; label: string; max: number }> = [
    { key: 'distance', label: 'Target distance', max: 50 },
    { key: 'repetition', label: 'Repetition', max: 50 },
    { key: 'geometry', label: 'Loop geometry', max: 30 },
    { key: 'issues', label: 'Route issues', max: 70 },
    { key: 'character', label: 'Route character', max: 50 },
  ];
  return (
    <>
      <Toggle
        label="Rank candidates with route-use evidence"
        value={props.evidenceRanking}
        onChange={props.onEvidenceRanking}
      />
      {sliders.map(({ key, label, max }) => (
        <View key={key}>
          <View style={styles.sliderHeader}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.output}>{props.scoringWeights[key]}</Text>
          </View>
          <Slider
            minimumValue={0}
            maximumValue={max}
            step={1}
            value={props.scoringWeights[key]}
            minimumTrackTintColor={props.accent}
            onSlidingComplete={(value) => props.onScoringWeights({ ...props.scoringWeights, [key]: value })}
            accessibilityLabel={`${label} points`}
          />
        </View>
      ))}
      <SmallButton label="Reset defaults" onPress={() => props.onScoringWeights(DEFAULT_LOOP_SCORING_WEIGHTS)} />
    </>
  );
}

function ChoiceButton({ label, selected, accent, onPress }: { label: string; selected: boolean; accent: string; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, selected && { borderColor: accent, backgroundColor: '#fff7f3' }]}><Text style={styles.choiceText}>{label}</Text></Pressable>; }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.toggleRow}><Text style={styles.label}>{label}</Text><Switch value={value} onValueChange={onChange} /></View>; }
function PreferenceSlider({ label, value, accent, onChange }: { label: string; value: number; accent: string; onChange: (value: number) => void }) { return <View><View style={styles.sliderHeader}><Text style={styles.label}>{label}</Text><Text style={styles.output}>{value.toFixed(1)}</Text></View><Slider minimumValue={0} maximumValue={1} step={0.1} value={value} minimumTrackTintColor={accent} onSlidingComplete={onChange} accessibilityLabel={label} /></View>; }
function Notice({ text, error, action, onAction }: { text: string; error?: boolean; action?: string; onAction?: () => void }) { return <View style={[styles.notice, error && styles.noticeError]}><Text style={styles.noticeText}>{text}</Text>{action && onAction && <SmallButton label={action} onPress={onAction} />}</View>; }
function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><Text style={styles.summaryLabel}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }
function Issue({ issue, selected, onPress, units }: { issue: RouteIssue; selected: boolean; onPress: () => void; units: UnitSystem }) { return <Pressable onPress={onPress} style={[styles.issue, selected && styles.issueSelected]}><Text style={styles.issueTitle}>{issue.severity === 'high' ? '▲' : '△'} {issue.title}</Text><Text style={styles.hint}>{issue.explanation} · {formatShortDistance(issue.lengthKm, units)}</Text>{issue.attributes.wayId && <Pressable onPress={() => void Linking.openURL(`https://www.openstreetmap.org/way/${issue.attributes.wayId}`)}><Text style={styles.link}>View recorded OSM way</Text></Pressable>}</Pressable>; }

function EdgeDetails({
  edge,
  units,
  onClose,
}: {
  edge: RouteEdge;
  units: UnitSystem;
  onClose: () => void;
}) {
  const attributes = edge.attributes;
  const recorded = (value?: string) => value ?? 'Not recorded';
  const grade = Math.max(Math.abs(attributes.maxUpwardGrade ?? 0), Math.abs(attributes.maxDownwardGrade ?? 0));
  const rows = [
    ['Way', attributes.name ?? 'Unnamed'],
    ['Kind', recorded(useName(attributes.use))],
    ['Road type', recorded(roadClassName(attributes.roadClass))],
    ['Surface', recorded(surfaceName(attributes.surface))],
    ['Suitable for', recorded(travelModeName(attributes.travelMode))],
    ['Pavement', recorded(sidewalkName(attributes.sidewalk))],
    ['Cycle lane', recorded(cycleLaneName(attributes.cycleLane))],
    ['Steepest point', grade >= 32000 ? 'Unavailable' : `${grade.toFixed(0)}%`],
  ];
  return <View style={styles.panel}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Route segment</Text><SmallButton label="Close" onPress={onClose} /></View><Text style={styles.hint}>Recorded details for {formatShortDistance(edge.lengthKm, units)}.</Text>{rows.map(([label, value]) => <View key={label} style={styles.detailRow}><Text style={styles.muted}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>)}{attributes.wayId && <Pressable onPress={() => void Linking.openURL(`https://www.openstreetmap.org/way/${attributes.wayId}`)}><Text style={styles.link}>View recorded OSM way</Text></Pressable>}</View>;
}

const duration = (seconds: number) => { const minutes = Math.round(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`; };

const styles = StyleSheet.create({
  desktop: { position: 'absolute', top: DESKTOP_PANEL.left, bottom: DESKTOP_PANEL.left, left: DESKTOP_PANEL.left, width: DESKTOP_PANEL.width, overflow: 'hidden', backgroundColor: COLOR.surface, borderWidth: 1, borderColor: COLOR.line, borderRadius: 24 },
  desktopHeader: { paddingTop: 14 },
  content: { paddingHorizontal: 18, paddingTop: 4, gap: 12 },

  peek: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
  peekGrow: { flex: 1 },
  peekLine: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  peekTitle: { color: COLOR.ink, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  pending: { color: COLOR.faint, fontSize: 11, fontWeight: '700' },
  delta: { fontSize: 12, fontWeight: '900', fontVariant: ['tabular-nums'] },
  accentBar: { position: 'absolute', bottom: 0, left: 18, width: 34, height: 3, borderRadius: 2 },
  eyebrow: { color: COLOR.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },

  searchRow: { flexDirection: 'row', gap: 6 },
  searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: COLOR.line, borderRadius: 11, backgroundColor: COLOR.raised, color: COLOR.ink },
  searchResult: { padding: 11, borderRadius: 10, backgroundColor: COLOR.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLOR.line },
  searchResultText: { color: COLOR.ink, fontSize: 12 },

  buttonRow: { flexDirection: 'row', gap: 6 },
  choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLOR.line, borderRadius: 11, backgroundColor: COLOR.raised }, choiceText: { color: COLOR.ink, fontSize: 11, fontWeight: '700' },
  panel: { gap: 9, padding: 12, borderRadius: RADIUS.panel, backgroundColor: COLOR.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLOR.line },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: COLOR.ink, fontSize: 13, fontWeight: '700' },
  hint: { color: COLOR.muted, fontSize: 12, lineHeight: 17 },
  prompt: { gap: 4, padding: 12, borderRadius: RADIUS.panel, borderWidth: 1.5, backgroundColor: COLOR.raised },
  promptTitle: { color: COLOR.ink, fontSize: 14, fontWeight: '900' },
  disclaimer: { color: COLOR.muted, fontSize: 10, lineHeight: 15 },
  scaleEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  scaleEnd: { color: COLOR.muted, fontSize: 10 },
  choiceRow: { flexDirection: 'row', gap: 6 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLOR.ink, fontSize: 14, fontWeight: '900' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' }, output: { color: COLOR.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 11, backgroundColor: '#e9efe5' }, noticeError: { backgroundColor: '#f9e3df' }, noticeText: { flex: 1, color: COLOR.ink, fontSize: 12 },
  alternative: { gap: 3, padding: 10, borderWidth: 2, borderColor: 'transparent', borderRadius: 11, backgroundColor: COLOR.raised }, alternativeTitle: { color: COLOR.ink, fontWeight: '900' },
  // The numbers read as part of the sheet rather than as a black slab dropped
  // into it; the accent stays on the one action in the group.
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 12, borderRadius: RADIUS.panel, backgroundColor: COLOR.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: COLOR.line },
  summaryItem: { minWidth: '44%' }, summaryLabel: { color: COLOR.muted, fontSize: 11 }, summaryValue: { color: COLOR.ink, fontSize: 15, fontWeight: '900' }, summaryAction: { width: '100%' },
  muted: { color: COLOR.faint, fontSize: 11 },
  overlayRow: { gap: 6, paddingVertical: 1 },
  overlayPill: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLOR.line, backgroundColor: COLOR.raised },
  overlayPillText: { color: COLOR.ink, fontSize: 11, fontWeight: '800' },
  overlayPillTextActive: { color: '#fff' },
  scoreBreakdown: { color: '#75682e', fontSize: 10, lineHeight: 14 },
  issue: { gap: 3, padding: 10, borderRadius: 10, backgroundColor: COLOR.raised }, issueSelected: { backgroundColor: '#fff3c4' }, issueTitle: { color: COLOR.ink, fontWeight: '800' }, link: { color: '#245fb4', fontSize: 11, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, detailValue: { flex: 1, color: COLOR.ink, fontSize: 12, textAlign: 'right' },
});
