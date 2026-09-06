import Slider from '@react-native-community/slider';
import { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
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
import type { ColourSpan, LegendEntry } from '../../../../src/domain/route-overlays';
import type { RouteSeries } from '../../../../src/domain/route-series';
import { COLOR, RADIUS, SHADOW } from '@/theme';
import { ACTIVITY, CREATION_MODES } from '@/domain/models';
import { NOMINATIM_URL } from '@/services/endpoints';
import type {
  Coordinate,
  LoopScoringWeights,
  PlannerState,
  RouteIssue,
  RouteEdge,
  RoutingPreferences,
  Waypoint,
} from '@/domain/models';
import { editableWaypoints } from '@/domain/waypoints';
import { DragSheet } from './drag-sheet';
import { Collapsible } from './ui/collapsible';
import { GlassSurface } from './ui/glass-surface';
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
  onMode: (mode: PlannerState['plan']['mode']) => void;
  onActivity: (activity: PlannerState['plan']['activity']) => void;
  onPreferences: (preferences: RoutingPreferences) => void;
  onTool: (tool: PlannerState['activeTool']) => void;
  onTarget: (km: number) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onCancel: () => void;
  onSelectAlternative: (id: string) => void;
  onReverse: () => void;
  /** Replaces the editable waypoints after a reorder, removal or reversal. */
  onWaypoints: (points: Waypoint[]) => void;
  onClear: () => void;
  onIssue: (issue: RouteIssue) => void;
  onEdgeDismiss: () => void;
  onProfile: (coordinate?: Coordinate) => void;
  onSheet: (sheet: PlannerState['sheet']) => void;
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
let lastSearch = 0;

export function PlannerSheet(props: Props) {
  const { state } = props;
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

  // Dragging the sheet with the keyboard up otherwise leaves it stranded over
  // whatever the sheet slid to.
  useEffect(() => {
    Keyboard.dismiss();
  }, [state.sheet]);

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

  const peek = (
    <Peek
      state={state}
      accent={accent}
      onLess={() => props.onSheet(state.sheet === 'full' ? 'half' : 'collapsed')}
      onMore={() => props.onSheet(state.sheet === 'collapsed' ? 'half' : 'full')}
    />
  );

  const body = (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={search}
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

      <Segmented
        accessibilityLabel="Activity"
        values={(Object.keys(ACTIVITY) as Array<keyof typeof ACTIVITY>).map((value) => ({
          value,
          label: ACTIVITY[value].label,
        }))}
        selected={state.plan.activity}
        accent={accent}
        onChange={props.onActivity}
      />
      <Segmented
        accessibilityLabel="Route type"
        values={CREATION_MODES}
        selected={state.plan.mode}
        accent={accent}
        onChange={props.onMode}
      />

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

      <Text style={styles.hint}>{hint(state)}</Text>

      <PointsPanel {...props} accent={accent} />

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Route preferences</Text>
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
                {String.fromCharCode(65 + index)} · {alternative.result.distanceKm.toFixed(1)} km
              </Text>
              <Text style={styles.hint}>{alternative.label}</Text>
              {__DEV__ && alternative.metrics && (
                <Text style={styles.scoreBreakdown}>
                  Distance −{alternative.metrics.distancePenaltyPoints.toFixed(1)} · Repetition −
                  {alternative.metrics.repetitionPenaltyPoints.toFixed(1)} · Geometry −
                  {alternative.metrics.geometryPenaltyPoints.toFixed(1)} · Issues −
                  {alternative.metrics.issuePenaltyPoints.toFixed(1)} · Evidence +
                  {alternative.metrics.evidenceBonusPoints.toFixed(1)} · Final{' '}
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
            <SummaryItem label="Distance" value={`${state.selectedRoute.distanceKm.toFixed(1)} km`} />
            <SummaryItem label="Time" value={duration(state.selectedRoute.durationSeconds)} />
            {state.selectedRoute.ascentM !== undefined && (
              <SummaryItem
                label="Elevation"
                value={`≈ ${state.selectedRoute.ascentM} m ↑ · ${state.selectedRoute.descentM} m ↓`}
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
            <PrimaryButton accent={accent} label="Export GPX" onPress={props.onExport} />
          </View>

          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{props.series.label} over distance</Text>
            {props.series.points.length ? (
              <ProfileChart
                series={props.series}
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
      <GlassSurface variant="regular" style={[styles.desktop, SHADOW.sheet]}>
        <View style={styles.desktopHeader}>{peek}</View>
        {body}
      </GlassSurface>
    );
  }

  return (
    <DragSheet
      snap={state.sheet}
      onSnap={props.onSheet}
      height={props.sheetHeight}
      bottomInset={insets.bottom}
      peek={peek}
    >
      {body}
    </DragSheet>
  );
}

function Peek({
  state,
  accent,
  onLess,
  onMore,
}: {
  state: PlannerState;
  accent: string;
  onLess: () => void;
  onMore: () => void;
}) {
  const route = state.selectedRoute;
  const mode = CREATION_MODES.find((item) => item.value === state.plan.mode)?.label ?? '';
  return (
    <View style={styles.peek}>
      <View style={styles.peekGrow}>
        <Text style={styles.eyebrow}>
          {ACTIVITY[state.plan.activity].label.toUpperCase()} · {mode.toUpperCase()}
        </Text>
        <Text style={styles.peekTitle} numberOfLines={1}>
          {route
            ? `${route.distanceKm.toFixed(1)} km · ${duration(route.durationSeconds)}`
            : state.loading
              ? 'Calculating route…'
              : 'Make a route worth taking'}
        </Text>
      </View>
      <View style={styles.peekActions}>
        <SmallButton label="Less" onPress={onLess} />
        <SmallButton label="More" onPress={onMore} dark={state.sheet === 'collapsed'} />
      </View>
      {state.sheet !== 'collapsed' && <View style={[styles.accentBar, { backgroundColor: accent }]} />}
    </View>
  );
}

function PointsPanel(props: Props & { accent: string }) {
  const { state, accent } = props;
  const editable = state.interaction === 'edit';
  const points = editableWaypoints(state);
  if (!points.length) return null;
  const loop = state.plan.mode === 'loop';

  const rows: WaypointRow[] = points.map((point, index) => ({
    id: point.id,
    index,
    role: point.role,
    locked: loop && index === 0,
    title: loop
      ? index === 0
        ? 'Start & finish'
        : `Loop point ${index}`
      : point.role === 'start'
        ? 'Start'
        : point.role === 'destination'
          ? 'Finish'
          : `Via point ${index}`,
    subtitle: `${point.coordinate.lat.toFixed(5)}, ${point.coordinate.lon.toFixed(5)}`,
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
            {!loop && points.length > 1 && <SmallButton label="Reverse" onPress={props.onReverse} />}
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
  return (
    <>
      {state.plan.activity === 'cycle' ? (
        <>
          <PreferenceSlider
            label="Road comfort"
            value={pref.roadComfort}
            accent={accent}
            onChange={(roadComfort) => props.onPreferences({ ...pref, roadComfort })}
          />
          <Toggle
            label="Prefer paved surfaces"
            value={pref.pavedPreference}
            onChange={(pavedPreference) => props.onPreferences({ ...pref, pavedPreference })}
          />
          <Text style={styles.disclaimer}>
            Higher comfort favours lower-road-use routing and recorded cycling infrastructure; it is
            not a guarantee.
          </Text>
        </>
      ) : (
        <>
          <PreferenceSlider
            label="Prefer paths & pavements"
            value={pref.pathPreference}
            accent={accent}
            onChange={(pathPreference) => props.onPreferences({ ...pref, pathPreference })}
          />
          <Toggle
            label="Prefer to avoid steps"
            value={pref.avoidSteps}
            onChange={(avoidSteps) => props.onPreferences({ ...pref, avoidSteps })}
          />
        </>
      )}
      <PreferenceSlider
        label="Hill preference"
        value={pref.hillPreference}
        accent={accent}
        onChange={(hillPreference) => props.onPreferences({ ...pref, hillPreference })}
      />
    </>
  );
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
  return 'Select a tool, tap the map, or drag any point to edit.';
}

function DeveloperSettings(props: Props & { accent: string }) {
  const sliders: Array<{ key: keyof LoopScoringWeights; label: string; max: number }> = [
    { key: 'distance', label: 'Target distance', max: 50 },
    { key: 'repetition', label: 'Repetition', max: 50 },
    { key: 'geometry', label: 'Loop geometry', max: 30 },
    { key: 'issues', label: 'Route issues', max: 70 },
    { key: 'evidence', label: 'Evidence bonus', max: 15 },
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

/**
 * Keeps its own text while the planner types, so clearing the field leaves it
 * empty instead of snapping back to the clamped minimum.
 */
function DistanceField({ value, onChange }: { value: number; onChange: (km: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);
  return (
    <View style={styles.distanceWrap}>
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
        style={styles.distanceInput}
        accessibilityLabel="Target distance in kilometres"
      />
      <Text style={styles.muted}>km</Text>
    </View>
  );
}

function ChoiceButton({ label, selected, accent, onPress }: { label: string; selected: boolean; accent: string; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, selected && { borderColor: accent, backgroundColor: '#fff7f3' }]}><Text style={styles.choiceText}>{label}</Text></Pressable>; }
function SmallButton({ label, onPress, dark }: { label: string; onPress: () => void; dark?: boolean }) { return <Pressable onPress={onPress} style={[styles.smallButton, dark && styles.darkButton]}><Text style={[styles.smallButtonText, dark && styles.darkButtonText]}>{label}</Text></Pressable>; }
function PrimaryButton({ label, accent, onPress, disabled }: { label: string; accent: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primary, { backgroundColor: accent }, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.toggleRow}><Text style={styles.label}>{label}</Text><Switch value={value} onValueChange={onChange} /></View>; }
function PreferenceSlider({ label, value, accent, onChange }: { label: string; value: number; accent: string; onChange: (value: number) => void }) { return <View><View style={styles.sliderHeader}><Text style={styles.label}>{label}</Text><Text style={styles.output}>{value.toFixed(1)}</Text></View><Slider minimumValue={0} maximumValue={1} step={0.1} value={value} minimumTrackTintColor={accent} onSlidingComplete={onChange} accessibilityLabel={label} /></View>; }
function Notice({ text, error, action, onAction }: { text: string; error?: boolean; action?: string; onAction?: () => void }) { return <View style={[styles.notice, error && styles.noticeError]}><Text style={styles.noticeText}>{text}</Text>{action && onAction && <SmallButton label={action} onPress={onAction} />}</View>; }
function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><Text style={styles.muted}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }
function Issue({ issue, selected, onPress }: { issue: RouteIssue; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.issue, selected && styles.issueSelected]}><Text style={styles.issueTitle}>{issue.severity === 'high' ? '▲' : '△'} {issue.title}</Text><Text style={styles.hint}>{issue.explanation} · {issue.lengthKm < 0.1 ? `${Math.round(issue.lengthKm * 1000)} m` : `${issue.lengthKm.toFixed(1)} km`}</Text>{issue.attributes.wayId && <Pressable onPress={() => void Linking.openURL(`https://www.openstreetmap.org/way/${issue.attributes.wayId}`)}><Text style={styles.link}>View recorded OSM way</Text></Pressable>}</Pressable>; }

function EdgeDetails({ edge, onClose }: { edge: RouteEdge; onClose: () => void }) {
  const attributes = edge.attributes;
  const recorded = (value?: string) => !value || value === 'none' ? 'Not recorded' : value.replaceAll('_', ' ');
  const grade = Math.max(Math.abs(attributes.maxUpwardGrade ?? 0), Math.abs(attributes.maxDownwardGrade ?? 0));
  const rows = [
    ['Way', attributes.name ?? 'Unnamed'], ['Use', recorded(attributes.use)],
    ['Road class', recorded(attributes.roadClass)], ['Surface', recorded(attributes.surface)],
    ['Travel mode', recorded(attributes.travelMode)], ['Sidewalk', recorded(attributes.sidewalk)],
    ['Cycle lane', recorded(attributes.cycleLane)],
    ['Maximum grade', grade >= 32000 ? 'Unavailable' : `${grade.toFixed(0)}%`],
  ];
  return <View style={styles.panel}><View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Route segment</Text><SmallButton label="Close" onPress={onClose} /></View><Text style={styles.hint}>Recorded attributes for {edge.lengthKm < 0.1 ? `${Math.round(edge.lengthKm * 1000)} m` : `${edge.lengthKm.toFixed(1)} km`}.</Text>{rows.map(([label, value]) => <View key={label} style={styles.detailRow}><Text style={styles.muted}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>)}{attributes.wayId && <Pressable onPress={() => void Linking.openURL(`https://www.openstreetmap.org/way/${attributes.wayId}`)}><Text style={styles.link}>View recorded OSM way</Text></Pressable>}</View>;
}

const duration = (seconds: number) => { const minutes = Math.round(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`; };

const styles = StyleSheet.create({
  desktop: { position: 'absolute', top: 12, bottom: 12, left: 12, width: 410, overflow: 'hidden', borderWidth: 1, borderColor: COLOR.line, borderRadius: 24 },
  desktopHeader: { paddingTop: 14 },
  content: { paddingHorizontal: 18, paddingTop: 4, gap: 12 },

  peek: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 12 },
  peekGrow: { flex: 1 },
  peekTitle: { color: COLOR.ink, fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  peekActions: { flexDirection: 'row', gap: 5 },
  accentBar: { position: 'absolute', bottom: 0, left: 18, width: 34, height: 3, borderRadius: 2 },
  eyebrow: { color: COLOR.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },

  searchRow: { flexDirection: 'row', gap: 6 },
  searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: COLOR.line, borderRadius: 11, backgroundColor: COLOR.raised, color: COLOR.ink },
  searchResult: { padding: 11, borderRadius: 10, backgroundColor: '#eef1eb' },
  searchResultText: { color: COLOR.ink, fontSize: 12 },

  buttonRow: { flexDirection: 'row', gap: 6 },
  choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLOR.line, borderRadius: 11, backgroundColor: COLOR.raised }, choiceText: { color: COLOR.ink, fontSize: 11, fontWeight: '700' },
  panel: { gap: 9, padding: 12, borderRadius: RADIUS.panel, backgroundColor: COLOR.panel },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { color: COLOR.ink, fontSize: 13, fontWeight: '700' },
  distanceWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  distanceInput: { width: 66, minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: '#ccd2cb', borderRadius: 9, backgroundColor: COLOR.raised, color: COLOR.ink, fontSize: 17, fontWeight: '900' },
  hint: { color: COLOR.muted, fontSize: 12, lineHeight: 17 },
  disclaimer: { color: COLOR.muted, fontSize: 10, lineHeight: 15 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLOR.ink, fontSize: 14, fontWeight: '900' },
  smallButton: { minHeight: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ccd2cb', borderRadius: 9, backgroundColor: COLOR.raised },
  smallButtonText: { color: COLOR.ink, fontSize: 11, fontWeight: '800' },
  darkButton: { backgroundColor: COLOR.ink, borderColor: COLOR.ink }, darkButtonText: { color: '#fff' },
  primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, primaryText: { color: '#fff', fontWeight: '900' }, disabled: { opacity: 0.4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' }, output: { color: COLOR.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 11, backgroundColor: '#e9efe5' }, noticeError: { backgroundColor: '#f9e3df' }, noticeText: { flex: 1, color: COLOR.ink, fontSize: 12 },
  alternative: { gap: 3, padding: 10, borderWidth: 2, borderColor: 'transparent', borderRadius: 11, backgroundColor: COLOR.raised }, alternativeTitle: { color: COLOR.ink, fontWeight: '900' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: RADIUS.panel, backgroundColor: COLOR.ink }, summaryItem: { minWidth: '44%' }, summaryValue: { color: '#fff', fontWeight: '900' }, muted: { color: COLOR.faint, fontSize: 11 },
  scoreBreakdown: { color: '#75682e', fontSize: 10, lineHeight: 14 },
  issue: { gap: 3, padding: 10, borderRadius: 10, backgroundColor: COLOR.raised }, issueSelected: { backgroundColor: '#fff3c4' }, issueTitle: { color: COLOR.ink, fontWeight: '800' }, link: { color: '#245fb4', fontSize: 11, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, detailValue: { flex: 1, color: COLOR.ink, fontSize: 12, textAlign: 'right' },
});
