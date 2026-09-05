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

import { DEFAULT_LOOP_SCORING_WEIGHTS } from '../../../../src/domain/route-scoring';
import { ACTIVITY, CREATION_MODES } from '@/domain/models';
import { NOMINATIM_URL } from '@/services/endpoints';
import type {
  Coordinate,
  LoopScoringWeights,
  PlannerState,
  RouteIssue,
  RouteEdge,
  RoutingPreferences,
} from '@/domain/models';

type Props = {
  state: PlannerState;
  scoringWeights: LoopScoringWeights;
  evidenceRanking: boolean;
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
  onRemove: (id: string) => void;
  onClear: () => void;
  onIssue: (issue: RouteIssue) => void;
  onEdgeDismiss: () => void;
  onProfile: (coordinate?: Coordinate) => void;
  onSheet: (sheet: PlannerState['sheet']) => void;
  onSearchSelect: (coordinate: Coordinate) => void;
  onLocate: () => void;
  onExport: () => void;
  onFitRoute: () => void;
};

type SearchResult = { place_id: number; display_name: string; lat: string; lon: string };
const SEARCH_ENDPOINT = NOMINATIM_URL;
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
  const accent = ACTIVITY[state.plan.activity].color;
  const pref = state.plan.preferences;

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

  if (state.sheet === 'collapsed') {
    return (
      <Pressable style={[styles.collapsed, { bottom: Math.max(insets.bottom, 12) }]} onPress={() => props.onSheet('half')}>
        <Text style={styles.collapsedText}>
          {ACTIVITY[state.plan.activity].label} · {state.selectedRoute
            ? `${state.selectedRoute.distanceKm.toFixed(1)} km · ${duration(state.selectedRoute.durationSeconds)}`
            : state.loading ? 'Calculating route…' : 'Tap to plan'}
        </Text>
        <Text style={[styles.collapsedAction, { color: accent }]}>Plan & details</Text>
      </Pressable>
    );
  }

  const heightStyle = state.sheet === 'full' ? styles.sheetFull : styles.sheetHalf;
  return (
    <View style={[
      styles.sheet,
      desktop ? styles.sheetDesktop : [styles.sheetMobile, heightStyle],
      !desktop && { paddingBottom: Math.max(insets.bottom, 8) },
    ]}>
      {!desktop && <View style={styles.handle} />}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <View style={styles.titleGrow}>
            <Text style={styles.eyebrow}>OPENLOOPER</Text>
            <Text style={styles.title}>Make a route worth taking</Text>
          </View>
          <View style={styles.sheetActions}>
            <SmallButton label="Less" onPress={() => props.onSheet(state.sheet === 'full' ? 'half' : 'collapsed')} />
            <SmallButton label="More" onPress={() => props.onSheet('full')} />
          </View>
        </View>

        <View style={styles.searchRow}>
          <TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} placeholder="Find a place" placeholderTextColor="#7b857d" returnKeyType="search" style={styles.searchInput} accessibilityLabel="Find a place" />
          <SmallButton label={searching ? '…' : 'Search'} onPress={search} dark />
          <SmallButton label="Locate" onPress={props.onLocate} />
        </View>
        {!!searchError && <Notice text={searchError} error />}
        {results.map((result) => (
          <Pressable key={result.place_id} style={styles.searchResult} onPress={() => {
            props.onSearchSelect({ lat: Number(result.lat), lon: Number(result.lon) });
            setResults([]);
          }}>
            <Text style={styles.searchResultText}>{result.display_name}</Text>
          </Pressable>
        ))}

        <Segmented
          values={(Object.keys(ACTIVITY) as Array<keyof typeof ACTIVITY>).map((value) => ({ value, label: ACTIVITY[value].label }))}
          selected={state.plan.activity}
          accent={accent}
          onChange={props.onActivity}
        />
        <Segmented values={CREATION_MODES} selected={state.plan.mode} accent={accent} onChange={props.onMode} />

        {state.plan.mode === 'pointToPoint' && (
          <View style={styles.buttonRow}>
            {(['start', 'destination', 'add'] as const).map((tool) => (
              <ChoiceButton key={tool} selected={state.activeTool === tool} accent={accent} onPress={() => props.onTool(tool)} label={tool === 'start' ? 'Set start' : tool === 'destination' ? 'Set finish' : 'Add point'} />
            ))}
          </View>
        )}
        {state.plan.mode === 'sketch' && state.sketchCompleted && (
          <ChoiceButton selected={state.activeTool === 'add'} accent={accent} onPress={() => props.onTool('add')} label="Add point" />
        )}

        {state.plan.mode === 'loop' && (
          <View style={styles.panel}>
            <View style={styles.fieldRow}>
              <Text style={styles.label}>Target distance</Text>
              <View style={styles.distanceWrap}>
                <TextInput value={String(state.plan.targetDistanceKm ?? 10)} onChangeText={(value) => props.onTarget(Number(value))} keyboardType="decimal-pad" style={styles.distanceInput} />
                <Text style={styles.muted}>km</Text>
              </View>
            </View>
            <PrimaryButton accent={accent} disabled={!state.plan.waypoints.length || state.loading} label={state.alternatives.length ? 'Generate loops' : 'Find loops'} onPress={props.onGenerate} />
            {!!state.alternatives.length && <SmallButton label="Regenerate differently" onPress={props.onRegenerate} />}
          </View>
        )}

        <Text style={styles.hint}>{state.plan.mode === 'sketch'
          ? state.sketchCompleted ? 'Sketch complete. Add or drag points to edit the routed shape.' : state.plan.waypoints.length < 2 ? 'Tap the map to place a start and endpoint.' : 'Keep tapping to extend. Tap A to close or the endpoint to finish.'
          : state.plan.mode === 'loop' ? 'Choose a start on the map, then generate up to three distinct routes.' : 'Select a tool, tap the map, or drag any point to edit.'}</Text>

        {!!state.plan.waypoints.length && (
          <View style={styles.panel}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Points</Text>
              <View style={styles.buttonRow}><SmallButton label="Reverse" onPress={props.onReverse} /><SmallButton label="Clear" onPress={props.onClear} /></View>
            </View>
            {state.plan.waypoints.map((point, index) => (
              <View key={point.id} style={styles.pointRow}>
                <View style={[styles.pointDot, { backgroundColor: point.role === 'start' ? '#177657' : point.role === 'destination' ? '#b83c34' : '#273f78' }]}><Text style={styles.pointDotText}>{index + 1}</Text></View>
                <Text style={styles.pointLabel}>{point.role === 'generated' ? 'Loop shaping point' : state.plan.mode === 'loop' && point.role === 'destination' ? 'Return to start' : capitalize(point.role)}</Text>
                {state.plan.waypoints.length > 2 && index > 0 && index < state.plan.waypoints.length - 1 && <SmallButton label="Remove" onPress={() => props.onRemove(point.id)} />}
              </View>
            ))}
          </View>
        )}

        <View style={styles.panel}>
          <Text style={styles.sectionTitle}>Route preferences</Text>
          {state.plan.activity === 'cycle' ? (
            <>
              <PreferenceSlider label="Road comfort" value={pref.roadComfort} accent={accent} onChange={(roadComfort) => props.onPreferences({ ...pref, roadComfort })} />
              <Toggle label="Prefer paved surfaces" value={pref.pavedPreference} onChange={(pavedPreference) => props.onPreferences({ ...pref, pavedPreference })} />
              <Text style={styles.disclaimer}>Higher comfort favours lower-road-use routing and recorded cycling infrastructure; it is not a guarantee.</Text>
            </>
          ) : (
            <>
              <PreferenceSlider label="Prefer paths & pavements" value={pref.pathPreference} accent={accent} onChange={(pathPreference) => props.onPreferences({ ...pref, pathPreference })} />
              <Toggle label="Prefer to avoid steps" value={pref.avoidSteps} onChange={(avoidSteps) => props.onPreferences({ ...pref, avoidSteps })} />
            </>
          )}
          <PreferenceSlider label="Hill preference" value={pref.hillPreference} accent={accent} onChange={(hillPreference) => props.onPreferences({ ...pref, hillPreference })} />
        </View>

        {__DEV__ && <DeveloperSettings {...props} accent={accent} />}

        {state.loading && <Notice text={state.progress ?? 'Calculating route…'} action="Stop" onAction={props.onCancel} />}
        {!!state.error && <Notice text={state.error} error />}

        {state.alternatives.length > 1 && (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{state.plan.mode === 'loop' ? 'Loop choices' : 'Route choices'}</Text>
            {state.alternatives.map((alternative, index) => (
              <Pressable key={alternative.id} onPress={() => props.onSelectAlternative(alternative.id)} style={[styles.alternative, alternative.result.id === state.selectedRoute?.id && { borderColor: accent }]}>
                <Text style={styles.alternativeTitle}>{String.fromCharCode(65 + index)} · {alternative.result.distanceKm.toFixed(1)} km</Text>
                <Text style={styles.hint}>{alternative.label}</Text>
                {__DEV__ && alternative.metrics && <Text style={styles.scoreBreakdown}>Distance −{alternative.metrics.distancePenaltyPoints.toFixed(1)} · Repetition −{alternative.metrics.repetitionPenaltyPoints.toFixed(1)} · Geometry −{alternative.metrics.geometryPenaltyPoints.toFixed(1)} · Issues −{alternative.metrics.issuePenaltyPoints.toFixed(1)} · Evidence +{alternative.metrics.evidenceBonusPoints.toFixed(1)} · Final {alternative.metrics.score.toFixed(1)}</Text>}
              </Pressable>
            ))}
          </View>
        )}

        {state.selectedRoute && (
          <>
            <View style={styles.summary}>
              <SummaryItem label="Distance" value={`${state.selectedRoute.distanceKm.toFixed(1)} km`} />
              <SummaryItem label="Time" value={duration(state.selectedRoute.durationSeconds)} />
              {state.selectedRoute.ascentM !== undefined && <SummaryItem label="Elevation" value={`≈ ${state.selectedRoute.ascentM} m ↑ · ${state.selectedRoute.descentM} m ↓`} />}
              {state.selectedRoute.useEvidence && <SummaryItem label="Use evidence" value={state.selectedRoute.useEvidence.status === 'available' ? `${Math.round(state.selectedRoute.useEvidence.evidencedDistancePct)}% of distance` : 'Unavailable'} />}
              <SmallButton label="Fit route" onPress={props.onFitRoute} />
              <PrimaryButton accent={accent} label="Export GPX" onPress={props.onExport} />
            </View>
            <Elevation route={state.selectedRoute} onProfile={props.onProfile} />
            {state.highlightedEdgeIndex !== undefined && state.selectedRoute.edges[state.highlightedEdgeIndex] && (
              <EdgeDetails edge={state.selectedRoute.edges[state.highlightedEdgeIndex]} onClose={props.onEdgeDismiss} />
            )}
            <View style={styles.panel}>
              <Text style={styles.sectionTitle}>Route notes · {state.selectedRoute.issues.length}</Text>
              {!state.selectedRoute.edges.length ? <Text style={styles.hint}>Route-quality attribution is unavailable. Routing and elevation remain usable.</Text> : !state.selectedRoute.issues.length ? <Text style={styles.hint}>No issues were identified from the available route attributes. This is not a safety guarantee.</Text> : state.selectedRoute.issues.map((issue) => <Issue key={issue.id} issue={issue} selected={state.highlightedIssueId === issue.id} onPress={() => props.onIssue(issue)} />)}
              <Text style={styles.disclaimer}>Based on normalized route data. Not a guarantee of safety, accessibility, surface condition, traffic, lighting, or current hazards.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function DeveloperSettings(props: Props & { accent: string }) {
  const sliders: Array<{ key: keyof LoopScoringWeights; label: string; max: number }> = [
    { key: 'distance', label: 'Target distance', max: 50 },
    { key: 'repetition', label: 'Repetition', max: 50 },
    { key: 'geometry', label: 'Loop geometry', max: 30 },
    { key: 'issues', label: 'Route issues', max: 70 },
    { key: 'evidence', label: 'Evidence bonus', max: 15 },
  ];
  return <View style={styles.devPanel}>
    <Text style={styles.sectionTitle}>Development · loop scoring</Text>
    <Toggle label="Rank candidates with route-use evidence" value={props.evidenceRanking} onChange={props.onEvidenceRanking} />
    {sliders.map(({ key, label, max }) => <View key={key}>
      <View style={styles.sliderHeader}><Text style={styles.label}>{label}</Text><Text style={styles.output}>{props.scoringWeights[key]}</Text></View>
      <Slider minimumValue={0} maximumValue={max} step={1} value={props.scoringWeights[key]} minimumTrackTintColor={props.accent} onSlidingComplete={(value) => props.onScoringWeights({ ...props.scoringWeights, [key]: value })} accessibilityLabel={`${label} points`} />
    </View>)}
    <SmallButton label="Reset defaults" onPress={() => props.onScoringWeights(DEFAULT_LOOP_SCORING_WEIGHTS)} />
  </View>;
}

function Segmented<T extends string>({ values, selected, accent, onChange }: { values: readonly { value: T; label: string }[]; selected: T; accent: string; onChange: (value: T) => void }) {
  return <View style={styles.segmented}>{values.map((item) => <Pressable key={item.value} accessibilityRole="radio" accessibilityState={{ checked: selected === item.value }} onPress={() => onChange(item.value)} style={[styles.segment, selected === item.value && styles.segmentSelected]}><Text style={[styles.segmentText, selected === item.value && { color: accent }]}>{item.label}</Text></Pressable>)}</View>;
}
function ChoiceButton({ label, selected, accent, onPress }: { label: string; selected: boolean; accent: string; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.choice, selected && { borderColor: accent, backgroundColor: '#fff7f3' }]}><Text style={styles.choiceText}>{label}</Text></Pressable>; }
function SmallButton({ label, onPress, dark }: { label: string; onPress: () => void; dark?: boolean }) { return <Pressable onPress={onPress} style={[styles.smallButton, dark && styles.darkButton]}><Text style={[styles.smallButtonText, dark && styles.darkButtonText]}>{label}</Text></Pressable>; }
function PrimaryButton({ label, accent, onPress, disabled }: { label: string; accent: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[styles.primary, { backgroundColor: accent }, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>; }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.toggleRow}><Text style={styles.label}>{label}</Text><Switch value={value} onValueChange={onChange} /></View>; }
function PreferenceSlider({ label, value, accent, onChange }: { label: string; value: number; accent: string; onChange: (value: number) => void }) { return <View><View style={styles.sliderHeader}><Text style={styles.label}>{label}</Text><Text style={styles.output}>{value.toFixed(1)}</Text></View><Slider minimumValue={0} maximumValue={1} step={0.1} value={value} minimumTrackTintColor={accent} onSlidingComplete={onChange} /></View>; }
function Notice({ text, error, action, onAction }: { text: string; error?: boolean; action?: string; onAction?: () => void }) { return <View style={[styles.notice, error && styles.noticeError]}><Text style={styles.noticeText}>{text}</Text>{action && onAction && <SmallButton label={action} onPress={onAction} />}</View>; }
function SummaryItem({ label, value }: { label: string; value: string }) { return <View style={styles.summaryItem}><Text style={styles.muted}>{label}</Text><Text style={styles.summaryValue}>{value}</Text></View>; }
function Elevation({ route, onProfile }: { route: NonNullable<PlannerState['selectedRoute']>; onProfile: (coordinate?: Coordinate) => void }) {
  if (!route.elevation.length) return <View style={styles.panel}><Text style={styles.sectionTitle}>Elevation</Text><Text style={styles.hint}>Elevation is unavailable for this route.</Text></View>;
  const points = route.elevation.filter((_, index) => index % Math.max(1, Math.floor(route.elevation.length / 36)) === 0);
  const min = Math.min(...points.map((point) => point.elevationM));
  const max = Math.max(...points.map((point) => point.elevationM));
  return <View style={styles.panel}><Text style={styles.sectionTitle}>Elevation · {Math.round(min)}–{Math.round(max)} m</Text><View style={styles.elevationBars}>{points.map((point, index) => <Pressable key={`${point.distanceKm}-${index}`} accessibilityLabel={`${point.distanceKm.toFixed(1)} kilometres, ${Math.round(point.elevationM)} metres`} onPressIn={() => onProfile(point.coordinate)} onPressOut={() => onProfile()} style={[styles.elevationBar, { height: 16 + ((point.elevationM - min) / Math.max(1, max - min)) * 54 }]} />)}</View><Text style={styles.hint}>Press along the profile to locate that elevation on the map.</Text></View>;
}
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
const capitalize = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const duration = (seconds: number) => { const minutes = Math.round(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`; };

const styles = StyleSheet.create({
  sheet: { position: 'absolute', overflow: 'hidden', borderColor: 'rgba(23,32,25,0.12)', backgroundColor: 'rgba(250,251,247,0.98)', shadowColor: '#202d23', shadowOpacity: 0.2, shadowRadius: 26, shadowOffset: { width: 0, height: 10 } },
  sheetDesktop: { top: 12, bottom: 12, left: 12, width: 410, borderWidth: 1, borderRadius: 24 },
  sheetMobile: { right: 0, bottom: 0, left: 0, borderTopWidth: 1, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHalf: { maxHeight: '58%' }, sheetFull: { maxHeight: '92%' }, handle: { alignSelf: 'center', width: 44, height: 5, marginTop: 8, borderRadius: 3, backgroundColor: '#c1c8c0' },
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 30, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, titleGrow: { flex: 1 }, sheetActions: { flexDirection: 'row', gap: 5 }, eyebrow: { color: '#68736b', fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }, title: { color: '#172019', fontSize: 24, fontWeight: '900', letterSpacing: -0.8 },
  searchRow: { flexDirection: 'row', gap: 6 }, searchInput: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(23,32,25,0.12)', borderRadius: 11, backgroundColor: '#fff', color: '#172019' }, searchResult: { padding: 11, borderRadius: 10, backgroundColor: '#eef1eb' }, searchResultText: { color: '#172019', fontSize: 12 },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: 13, backgroundColor: '#e8ece5' }, segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 }, segmentSelected: { backgroundColor: '#fff' }, segmentText: { color: '#172019', fontSize: 13, fontWeight: '800' },
  buttonRow: { flexDirection: 'row', gap: 6 }, choice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(23,32,25,0.12)', borderRadius: 11, backgroundColor: '#fff' }, choiceText: { color: '#172019', fontSize: 11, fontWeight: '700' },
  panel: { gap: 9, padding: 12, borderRadius: 14, backgroundColor: '#f0f2ed' }, devPanel: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#937a30', borderRadius: 14, backgroundColor: '#fff8dc' },
  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, label: { color: '#172019', fontSize: 13, fontWeight: '700' }, distanceWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 }, distanceInput: { width: 60, minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: '#ccd2cb', borderRadius: 9, backgroundColor: '#fff', color: '#172019', fontSize: 17, fontWeight: '900' },
  hint: { color: '#68736b', fontSize: 12, lineHeight: 17 }, disclaimer: { color: '#68736b', fontSize: 10, lineHeight: 15 }, sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { color: '#172019', fontSize: 14, fontWeight: '900' }, pointRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, pointDot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, pointDotText: { color: '#fff', fontSize: 10, fontWeight: '900' }, pointLabel: { flex: 1, color: '#172019', fontSize: 12 },
  smallButton: { minHeight: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ccd2cb', borderRadius: 9, backgroundColor: '#fff' }, smallButtonText: { color: '#172019', fontSize: 11, fontWeight: '800' }, darkButton: { backgroundColor: '#172019' }, darkButtonText: { color: '#fff' }, primary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, primaryText: { color: '#fff', fontWeight: '900' }, disabled: { opacity: 0.4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sliderHeader: { flexDirection: 'row', justifyContent: 'space-between' }, output: { color: '#68736b', fontSize: 12, fontVariant: ['tabular-nums'] },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, borderRadius: 11, backgroundColor: '#e9efe5' }, noticeError: { backgroundColor: '#f9e3df' }, noticeText: { flex: 1, color: '#172019', fontSize: 12 },
  alternative: { gap: 3, padding: 10, borderWidth: 2, borderColor: 'transparent', borderRadius: 11, backgroundColor: '#fff' }, alternativeTitle: { color: '#172019', fontWeight: '900' }, summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#172019' }, summaryItem: { minWidth: '44%' }, summaryValue: { color: '#fff', fontWeight: '900' }, muted: { color: '#89948c', fontSize: 11 },
  scoreBreakdown: { color: '#75682e', fontSize: 10, lineHeight: 14 },
  elevationBars: { height: 74, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }, elevationBar: { flex: 1, minWidth: 2, borderTopLeftRadius: 2, borderTopRightRadius: 2, backgroundColor: '#247d60' }, issue: { gap: 3, padding: 10, borderRadius: 10, backgroundColor: '#fff' }, issueSelected: { backgroundColor: '#fff3c4' }, issueTitle: { color: '#172019', fontWeight: '800' }, link: { color: '#245fb4', fontSize: 11, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 }, detailValue: { flex: 1, color: '#172019', fontSize: 12, textAlign: 'right' },
  collapsed: { position: 'absolute', right: 12, left: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderRadius: 17, backgroundColor: '#fafbf7', shadowColor: '#202d23', shadowOpacity: 0.2, shadowRadius: 16 }, collapsedText: { color: '#172019', fontWeight: '700' }, collapsedAction: { fontWeight: '900' },
});
