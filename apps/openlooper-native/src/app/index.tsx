import * as Location from 'expo-location';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';

import { closestSegment, distanceKm } from '../../../../src/domain/geometry';
import { loopSeeds, scaleLoop } from '../../../../src/domain/loops';
import { analyzeRoute, mapEdges } from '../../../../src/domain/route-analysis';
import {
  DEFAULT_LOOP_SCORING_WEIGHTS,
  hasDisconnectedJump,
  LOOP_LIMITS,
  repeatedCoverage,
  repetitionDescription,
  routeSimilarity,
  scoreRoute,
  surfaceConcernPercentage,
} from '../../../../src/domain/route-scoring';
import type {
  Coordinate,
  LoopScoringWeights,
  PlannerState,
  RouteAlternative,
  RoutePlan,
  RouteResult,
  Waypoint,
} from '@/domain/models';
import { ACTIVITY, waypoint } from '@/domain/models';
import { closedLoop, editableWaypoints, loopAnchors, openLoop } from '@/domain/waypoints';
import { overlayRender, overlaySpans } from '../../../../src/domain/route-overlays';
import { routeSeries } from '../../../../src/domain/route-series';
import { MapControls } from '@/components/map-controls';
import { SHEET_FRACTION, sheetHeightFor } from '@/components/sheet-detents';
import { PlannerMap } from '@/components/planner-map';
import { PlannerSheet } from '@/components/planner-sheet';
import { routeEvidence, routeEvidenceBatch } from '@/services/evidence';
import { exportGpx } from '@/services/gpx';
import { persistPlanner, restorePlanner } from '@/services/persistence';
import { requestRoute, traceRoute } from '@/services/routing';
import {
  initialPlannerState,
  normalizedWaypoints,
  plannerReducer,
  routePlan,
} from '@/state/planner';

async function pool<T, R>(
  items: T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const output: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        output[index] = { status: 'fulfilled', value: await work(items[index]!, index) };
      } catch (reason) {
        output[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function loopLabel(result: RouteResult, metrics: NonNullable<RouteAlternative['metrics']>) {
  const evidence = result.useEvidence?.status === 'available'
    ? `${Math.round(result.useEvidence.evidencedDistancePct)}% evidenced distance`
    : 'evidenced distance unavailable';
  return [
    `${Math.round(metrics.distanceError * 100)}% target error`,
    repetitionDescription(metrics.repeatedCoverage),
    `${Math.round(surfaceConcernPercentage(result))}% recorded unpaved/rough concern`,
    evidence,
  ].join(' · ');
}

async function attributeGeometry(result: RouteResult, plan: RoutePlan, signal?: AbortSignal) {
  const trace = await traceRoute(result, plan.activity, signal);
  const edges = mapEdges(trace.edges ?? [], result.geometry.length);
  if (!edges.length) throw new Error('Route attribution did not align to the returned route.');
  return { ...result, edges, issues: analyzeRoute(result, edges, plan.activity) };
}

export default function PlannerScreen() {
  const [state, dispatch] = useReducer(plannerReducer, initialPlannerState);
  const [restored, setRestored] = useState(false);
  const [evidenceRanking, setEvidenceRanking] = useState(true);
  const [scoringWeights, setScoringWeights] = useState<LoopScoringWeights>(DEFAULT_LOOP_SCORING_WEIGHTS);
  const [fitRequest, setFitRequest] = useState(0);
  const [locating, setLocating] = useState(false);
  const { height: windowHeight, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 800;
  // Roughly how much of the map the sheet covers, used both to fit routes clear
  // of it and to centre a located point in the strip that stays visible.
  const sheetInset = useCallback(
    (sheet: PlannerState['sheet']) => (desktop ? 32 : sheetHeightFor(sheet, windowHeight)),
    [desktop, windowHeight],
  );
  const bottomInset = sheetInset(state.sheet);
  // Drives the floating controls so they ride above the sheet as it is dragged.
  // Seeded at the half detent the planner opens on, so nothing jumps on mount.
  const sheetHeight = useSharedValue(windowHeight * SHEET_FRACTION.half);
  const evidenceRankingRef = useRef(evidenceRanking);
  const scoringWeightsRef = useRef(scoringWeights);
  const currentState = useRef(state);
  const controller = useRef<AbortController | undefined>(undefined);
  const requestId = useRef(0);
  currentState.current = state;

  useEffect(() => {
    void restorePlanner().then((saved) => {
      if (saved) dispatch({ type: 'restore', state: saved });
      setRestored(true);
    });
  }, []);

  useEffect(() => {
    if (!restored) return;
    const timer = setTimeout(() => void persistPlanner(state), 350);
    return () => clearTimeout(timer);
  }, [restored, state]);

  const analyze = useCallback(async (result: RouteResult, plan: RoutePlan, signal?: AbortSignal) => {
    try {
      const attributed = await attributeGeometry(result, plan, signal);
      return { ...attributed, useEvidence: await routeEvidence(attributed, attributed.edges, signal) };
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      return { ...result, useEvidence: { status: 'unavailable' as const, evidencedDistanceKm: 0, evidencedDistancePct: 0 } };
    }
  }, []);

  const calculate = useCallback(async (plan: RoutePlan) => {
    if (plan.waypoints.length < 2) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    dispatch({ type: 'routeStart' });
    try {
      const routes = await requestRoute(plan, abort.signal, true);
      const selected = await analyze(routes[0]!, plan, abort.signal);
      if (id !== requestId.current) return;
      const alternatives: RouteAlternative[] = routes.map((result, index) => ({
        id: `route-${result.id}`,
        result: index === 0 ? selected : result,
        label: index === 0 ? 'Suggested route' : 'Alternative from Valhalla',
      }));
      dispatch({ type: 'routeSuccess', route: selected, alternatives });
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && id === requestId.current)
        dispatch({ type: 'routeError', error: (error as Error).message });
    }
  }, [analyze]);

  const setWaypoints = useCallback((points: Waypoint[], recalculate = true) => {
    const clean = normalizedWaypoints(points);
    dispatch({ type: 'waypoints', waypoints: clean });
    if (recalculate && clean.length >= 2) void calculate(routePlan(currentState.current, clean));
  }, [calculate]);

  /** Drops the current route and stops any routing still running against the
   * points it was built from. */
  const discardRoute = useCallback(() => {
    controller.current?.abort();
    requestId.current++;
    dispatch({ type: 'alternatives', alternatives: [] });
  }, []);

  /**
   * Reroutes a loop through the points it now has. Used for every hand edit, so
   * tuning a generated loop never throws the shape away and starts over.
   */
  const routeLoop = useCallback((points: Waypoint[]) => {
    const current = currentState.current;
    if (points.length < 2) {
      dispatch({ type: 'waypoints', waypoints: points });
      discardRoute();
      return;
    }
    const closed = closedLoop(points);
    dispatch({ type: 'waypoints', waypoints: closed });
    dispatch({ type: 'loopTuned', tuned: true });
    void calculate({ ...current.plan, waypoints: closed });
  }, [calculate, discardRoute]);

  const mapPress = useCallback((coordinate: Coordinate) => {
    const current = currentState.current;
    if (current.interaction === 'inspect') return;
    const points = current.plan.waypoints;
    if (current.plan.mode === 'loop') {
      const loop = editableWaypoints(current);
      if (!loop.length) {
        dispatch({ type: 'waypoints', waypoints: [waypoint(coordinate, 'start')] });
        dispatch({ type: 'tool', tool: 'add' });
        discardRoute();
        return;
      }
      if (current.activeTool === 'start') {
        const next = [waypoint(coordinate, 'start'), ...loop.slice(1)];
        if (current.selectedRoute) routeLoop(next);
        else {
          dispatch({ type: 'waypoints', waypoints: next });
          discardRoute();
        }
        return;
      }
      if (!current.selectedRoute) {
        dispatch({ type: 'waypoints', waypoints: [...loop, waypoint(coordinate, 'via')] });
        discardRoute();
        return;
      }
      // Slot the new point into the leg it was tapped beside, the same way the
      // A to B add tool does, instead of tacking it onto the end.
      const segment = closestSegment(current.selectedRoute.geometry, coordinate);
      const leg = current.selectedRoute.legs.findIndex((item) => segment <= item.endIndex);
      const insertion = leg >= 0 ? Math.min(leg + 1, loop.length) : loop.length;
      routeLoop([...loop.slice(0, insertion), waypoint(coordinate, 'via'), ...loop.slice(insertion)]);
      return;
    }
    if (current.activeTool === 'add' && current.selectedRoute) {
      const segment = closestSegment(current.selectedRoute.geometry, coordinate);
      const leg = current.selectedRoute.legs.findIndex((item) => segment <= item.endIndex);
      const insertion = leg >= 0 ? leg + 1 : points.length - 1;
      setWaypoints([...points.slice(0, insertion), waypoint(coordinate, 'via'), ...points.slice(insertion)]);
      return;
    }
    if (current.plan.mode === 'sketch') {
      if (current.sketchCompleted) return;
      if (!points.length) setWaypoints([waypoint(coordinate, 'start')], false);
      else if (points.length === 1) setWaypoints([...points, waypoint(coordinate, 'destination')]);
      else setWaypoints([...points.slice(0, -1), { ...points.at(-1)!, role: 'via' }, waypoint(coordinate, 'destination')]);
      return;
    }
    if (current.activeTool === 'start') {
      const next = points.length ? [waypoint(coordinate, 'start'), ...points.slice(1)] : [waypoint(coordinate, 'start')];
      setWaypoints(next, next.length >= 2);
      dispatch({ type: 'tool', tool: 'destination' });
    } else if (current.activeTool === 'destination') {
      const next = points.length > 1 ? [points[0]!, ...points.slice(1, -1), waypoint(coordinate, 'destination')] : [...points, waypoint(coordinate, 'destination')];
      setWaypoints(next);
    }
  }, [discardRoute, routeLoop, setWaypoints]);

  const waypointPress = useCallback((id: string) => {
    const current = currentState.current;
    if (current.interaction === 'inspect') return;
    if (current.plan.mode !== 'sketch' || current.sketchCompleted) return;
    const points = current.plan.waypoints;
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last || !points.some((point) => distanceKm(first.coordinate, point.coordinate) >= 0.001)) return;
    if (id === last.id) dispatch({ type: 'finishSketch' });
    else if (id === first.id) {
      setWaypoints([...points.slice(0, -1), { ...last, role: 'via' }, waypoint(first.coordinate, 'destination')]);
      dispatch({ type: 'finishSketch' });
    }
  }, [setWaypoints]);

  const generate = useCallback(async (override?: RoutePlan) => {
    const current = currentState.current;
    const plan = override ?? current.plan;
    const start = plan.waypoints[0]?.coordinate;
    const target = plan.targetDistanceKm ?? 10;
    if (!start || target < 1) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    dispatch({ type: 'routeStart', progress: 'Trying 12 loop shapes…' });
    // Generating replaces the shape wholesale, so the planner is no longer
    // tuning the one that was on screen.
    dispatch({ type: 'loopTuned', tuned: false });
    const seeds = loopSeeds(start, target, current.loopSeed, loopAnchors(plan.waypoints));
    const basePlan = { ...plan, mode: 'loop' as const };
    try {
      const initial = await pool(seeds, LOOP_LIMITS.maxConcurrent, async (seed, index) => {
        if (abort.signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
        dispatch({ type: 'progress', progress: `Trying loop shapes… ${index + 1}/12` });
        const [result] = await requestRoute({ ...basePlan, waypoints: seed.waypoints }, abort.signal, false);
        return { seed, result: result! };
      });
      let viable = initial.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []).filter((item) =>
        Math.abs(item.result.distanceKm - target) / target <= LOOP_LIMITS.maxDistanceError &&
        repeatedCoverage(item.result.geometry) <= LOOP_LIMITS.maxRepeatedCoverage &&
        !hasDisconnectedJump(item.result.geometry, target),
      );
      viable = viable.sort((a, b) => scoreRoute(b.result, target, [], false, scoringWeightsRef.current).score - scoreRoute(a.result, target, [], false, scoringWeightsRef.current).score).slice(0, target > 20 ? 6 : target > 10 ? 8 : viable.length);
      dispatch({ type: 'progress', progress: `Refining ${viable.length} promising loops…` });
      const refined = await pool(viable, LOOP_LIMITS.maxConcurrent, async ({ seed, result }) => {
        if (Math.abs(result.distanceKm - target) / target <= 0.03) return { seed, result };
        const factor = Math.max(LOOP_LIMITS.refinementMin, Math.min(LOOP_LIMITS.refinementMax, target / result.distanceKm));
        const adjusted = scaleLoop(seed, start, factor);
        const [route] = await requestRoute({ ...basePlan, waypoints: adjusted.waypoints }, abort.signal, false);
        return { seed: adjusted, result: route! };
      });
      viable = refined.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []).filter((item) =>
        Math.abs(item.result.distanceKm - target) / target <= LOOP_LIMITS.maxDistanceError &&
        repeatedCoverage(item.result.geometry) <= LOOP_LIMITS.maxRepeatedCoverage &&
        !hasDisconnectedJump(item.result.geometry, target),
      );
      const shortlist = viable.sort((a, b) => scoreRoute(b.result, target, [], false, scoringWeightsRef.current).score - scoreRoute(a.result, target, [], false, scoringWeightsRef.current).score).slice(0, 6);
      dispatch({ type: 'progress', progress: 'Checking route surfaces and issues…' });
      const attributed = await pool(shortlist, LOOP_LIMITS.maxConcurrent, async (item) => ({ ...item, result: await attributeGeometry(item.result, basePlan, abort.signal) }));
      const attributedRoutes = attributed.flatMap((item) => item.status === 'fulfilled' ? [item.value] : []);
      dispatch({ type: 'progress', progress: 'Checking route-use evidence…' });
      const evidence = await routeEvidenceBatch(attributedRoutes.map((item) => ({ id: item.result.id, route: item.result, edges: item.result.edges })), abort.signal);
      const ranked = attributedRoutes.map((item) => ({ ...item, result: { ...item.result, useEvidence: evidence.get(item.result.id) } })).map((item) => ({ ...item, metrics: scoreRoute(item.result, target, item.result.issues, evidenceRankingRef.current, scoringWeightsRef.current) })).sort((a, b) => b.metrics.score - a.metrics.score);
      const distinct: typeof ranked = [];
      for (const item of ranked) {
        if (distinct.every((other) => routeSimilarity(item.result.geometry, other.result.geometry) <= LOOP_LIMITS.dedupeSimilarity)) distinct.push(item);
        if (distinct.length === 3) break;
      }
      if (id !== requestId.current) return;
      if (!distinct.length) throw new Error('No useful loops survived around this start. Try a different distance, preference, or start point.');
      const alternatives: RouteAlternative[] = distinct.map((item) => ({ id: item.seed.id, result: item.result, metrics: item.metrics, waypoints: item.seed.waypoints, label: loopLabel(item.result, item.metrics) }));
      dispatch({ type: 'waypoints', waypoints: alternatives[0]!.waypoints! });
      dispatch({ type: 'alternatives', alternatives });
      if (distinct.length < 3) dispatch({ type: 'routeError', error: `Found ${distinct.length} distinct loop${distinct.length === 1 ? '' : 's'}; the local network shape limited generation.` });
    } catch (error) {
      if ((error as Error).name !== 'AbortError' && id === requestId.current) dispatch({ type: 'routeError', error: (error as Error).message });
    }
  }, []);

  function rerank(enabled: boolean, weights: LoopScoringWeights) {
    evidenceRankingRef.current = enabled;
    scoringWeightsRef.current = weights;
    setEvidenceRanking(enabled);
    setScoringWeights(weights);
    const current = currentState.current;
    if (current.plan.mode !== 'loop' || !current.alternatives.length) return;
    const target = current.plan.targetDistanceKm ?? 10;
    const alternatives = current.alternatives.map((item) => {
      const metrics = scoreRoute(item.result, target, item.result.issues, enabled, weights);
      return { ...item, metrics, label: loopLabel(item.result, metrics) };
    }).sort((a, b) => (b.metrics?.score ?? 0) - (a.metrics?.score ?? 0));
    dispatch({ type: 'alternatives', alternatives, preserveSelection: true });
  }

  function rerouteWith(next: Partial<RoutePlan>) {
    const current = currentState.current;
    controller.current?.abort();
    requestId.current++;
    const plan = { ...current.plan, ...next };
    // A loop being tuned by hand is rerouted through its own points; only an
    // untouched one is regenerated from fresh shapes.
    if (plan.mode === 'loop' && plan.waypoints.length && !current.loopTuned) {
      void generate(plan);
      return;
    }
    if (plan.waypoints.length >= 2) void calculate(plan);
  }

  function selectAlternative(id: string) {
    const alternative = state.alternatives.find((item) => item.id === id);
    if (!alternative) return;
    dispatch({ type: 'selectRoute', route: alternative.result });
    if (alternative.waypoints) {
      dispatch({ type: 'waypoints', waypoints: alternative.waypoints });
      dispatch({ type: 'loopTuned', tuned: false });
    }
    if (!alternative.result.edges.length) void analyze(alternative.result, routePlan(currentState.current)).then((result) => {
      if (currentState.current.selectedRoute?.id === result.id) dispatch({ type: 'selectRoute', route: result });
    });
  }

  /** Applies a marker drag. A dragged loop shaping point becomes a deliberate
   * one, so regenerating later keeps it. */
  const moveWaypoint = useCallback((id: string, coordinate: Coordinate) => {
    const current = currentState.current;
    const points = current.plan.waypoints.map((point) =>
      point.id === id
        ? { ...point, coordinate, role: point.role === 'generated' ? ('via' as const) : point.role }
        : point,
    );
    if (current.plan.mode === 'loop') routeLoop(openLoop(points));
    else setWaypoints(points);
  }, [routeLoop, setWaypoints]);

  /** Replaces the start without disturbing the rest of the plan, whichever mode
   * the planner is in. */
  const startAt = useCallback((coordinate: Coordinate) => {
    const current = currentState.current;
    if (current.plan.mode === 'loop') {
      const loop = editableWaypoints(current);
      const next = [waypoint(coordinate, 'start'), ...loop.slice(1)];
      dispatch({ type: 'tool', tool: 'add' });
      if (current.selectedRoute) routeLoop(next);
      else {
        dispatch({ type: 'waypoints', waypoints: next });
        discardRoute();
      }
      return;
    }
    const points = current.plan.waypoints;
    const next = points.length
      ? [waypoint(coordinate, 'start'), ...points.slice(1)]
      : [waypoint(coordinate, 'start')];
    setWaypoints(next, next.length >= 2);
    if (current.plan.mode === 'pointToPoint' && next.length < 2)
      dispatch({ type: 'tool', tool: 'destination' });
  }, [discardRoute, routeLoop, setWaypoints]);

  /** Replaces the editable points after a reorder or removal in the sheet. */
  const editWaypoints = useCallback((points: Waypoint[]) => {
    const current = currentState.current;
    if (current.plan.mode !== 'loop') {
      setWaypoints(points);
      // A single point can no longer describe a route, so drop the stale one.
      if (points.length < 2) discardRoute();
      return;
    }
    if (current.selectedRoute) {
      routeLoop(points);
      return;
    }
    dispatch({ type: 'waypoints', waypoints: points });
    discardRoute();
  }, [discardRoute, routeLoop, setWaypoints]);

  const setSheet = useCallback((sheet: PlannerState['sheet']) => {
    dispatch({ type: 'sheet', sheet });
  }, []);

  async function locate() {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        dispatch({ type: 'routeError', error: 'Location permission was unavailable or denied. Choose a start on the map instead.' });
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coordinate = { lat: position.coords.latitude, lon: position.coords.longitude };
      // A full sheet leaves too little map to show where the planner is, so it
      // steps back to half and the camera is centred for that.
      const sheet = currentState.current.sheet === 'full' ? 'half' : currentState.current.sheet;
      if (sheet !== currentState.current.sheet) dispatch({ type: 'sheet', sheet });
      dispatch({ type: 'camera', center: coordinate, zoom: 15 });
      startAt(coordinate);
    } catch (error) {
      dispatch({ type: 'routeError', error: `Your location is unavailable (${(error as Error).message}). Choose a start on the map instead.` });
    } finally {
      setLocating(false);
    }
  }

  const highlightedIssue = state.selectedRoute?.issues.find((issue) => issue.id === state.highlightedIssueId);
  const overlay = useMemo(
    () =>
      state.selectedRoute
        ? overlayRender(state.selectedRoute, state.overlay, ACTIVITY[state.plan.activity].color)
        : { bands: [], legend: [] },
    [state.overlay, state.plan.activity, state.selectedRoute],
  );
  const series = useMemo(
    () => routeSeries(state.selectedRoute, state.overlay),
    [state.overlay, state.selectedRoute],
  );
  const spans = useMemo(
    () => (state.selectedRoute ? overlaySpans(state.selectedRoute, overlay.bands) : []),
    [overlay.bands, state.selectedRoute],
  );

  useEffect(() => {
    // The desktop panel sits beside the map, so the controls only clear the
    // safe area rather than tracking a sheet.
    if (desktop) sheetHeight.value = insets.bottom;
  }, [desktop, insets.bottom, sheetHeight]);

  return (
    <View style={styles.root}>
      <PlannerMap
        activeTool={state.activeTool}
        interaction={state.interaction}
        bands={overlay.bands}
        showIssues={state.overlay === 'route'}
        camera={state.camera}
        mapStyle={state.mapStyle}
        bottomInset={bottomInset}
        waypoints={state.plan.waypoints}
        route={state.selectedRoute}
        fitRequest={fitRequest}
        alternatives={state.alternatives}
        highlightedIssue={highlightedIssue}
        profilePoint={state.profilePoint}
        onMapPress={mapPress}
        onWaypointPress={waypointPress}
        onWaypointMove={moveWaypoint}
        onIssuePress={(id) => dispatch({ type: 'highlightIssue', id })}
        onEdgePress={(index) => dispatch({ type: 'highlightEdge', index })}
        onAlternativePress={selectAlternative}
        onCameraChange={(center, zoom) => dispatch({ type: 'camera', center, zoom })}
      />
      <View pointerEvents="none" style={[styles.brandPill, { top: insets.top + 8 }]}>
        <Text style={styles.brand}>OPENLOOPER</Text>
      </View>
      <MapControls
        accent={ACTIVITY[state.plan.activity].color}
        mapStyle={state.mapStyle}
        offset={sheetHeight}
        gap={14}
        fadeAt={windowHeight * SHEET_FRACTION.full}
        overlay={state.overlay}
        onOverlay={(value) => dispatch({ type: 'overlay', overlay: value })}
        locating={locating}
        hasRoute={Boolean(state.selectedRoute)}
        interaction={state.interaction}
        onInteraction={(interaction) => dispatch({ type: 'interaction', interaction })}
        onMapStyle={(style) => dispatch({ type: 'mapStyle', style })}
        onLocate={() => void locate()}
        onFitRoute={() => setFitRequest((value) => value + 1)}
      />
      <PlannerSheet
        state={state}
        sheetHeight={sheetHeight}
        scoringWeights={scoringWeights}
        evidenceRanking={evidenceRanking}
        onEvidenceRanking={(enabled) => rerank(enabled, scoringWeightsRef.current)}
        onScoringWeights={(weights) => rerank(evidenceRankingRef.current, weights)}
        onMode={(mode) => dispatch({ type: 'mode', mode })}
        onActivity={(activity) => { dispatch({ type: 'activity', activity }); rerouteWith({ activity }); }}
        onPreferences={(preferences) => { dispatch({ type: 'preferences', preferences }); rerouteWith({ preferences }); }}
        onTool={(tool) => dispatch({ type: 'tool', tool })}
        onTarget={(distanceKm) => dispatch({ type: 'target', distanceKm })}
        onGenerate={() => void generate()}
        onRegenerate={() => { dispatch({ type: 'loopSeed' }); setTimeout(() => void generate(), 0); }}
        onCancel={() => { controller.current?.abort(); requestId.current++; dispatch({ type: 'routeError', error: 'Route calculation stopped.' }); }}
        onSelectAlternative={selectAlternative}
        onReverse={() => setWaypoints([...state.plan.waypoints].reverse())}
        onWaypoints={editWaypoints}
        onClear={() => { controller.current?.abort(); requestId.current++; dispatch({ type: 'clear' }); }}
        onIssue={(issue) => dispatch({ type: 'highlightIssue', id: issue.id })}
        onEdgeDismiss={() => dispatch({ type: 'highlightEdge' })}
        onProfile={(coordinate) => dispatch({ type: 'profilePoint', coordinate })}
        onSheet={setSheet}
        series={series}
        spans={spans}
        legend={overlay.legend}
        overlayUnavailable={overlay.unavailable}
        onSearchSelect={(coordinate) => {
          dispatch({ type: 'camera', center: coordinate, zoom: 15 });
          startAt(coordinate);
        }}
        onFocusPoint={(coordinate) =>
          dispatch({ type: 'camera', center: coordinate, zoom: Math.max(15, state.camera.zoom) })
        }
        onExport={() => {
          if (!state.selectedRoute) return;
          void exportGpx(state.selectedRoute, state.plan.activity).catch((error) => dispatch({ type: 'routeError', error: (error as Error).message }));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e9eee8' },
  brandPill: { position: 'absolute', right: 16, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(250,251,247,0.94)', shadowColor: '#172019', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
  brand: { color: '#172019', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
});
