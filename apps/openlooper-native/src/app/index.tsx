import * as Location from 'expo-location';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
  RouteAlternative,
  RoutePlan,
  RouteResult,
  Waypoint,
} from '@/domain/models';
import { waypoint } from '@/domain/models';
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

  const mapPress = useCallback((coordinate: Coordinate) => {
    const current = currentState.current;
    const points = current.plan.waypoints;
    if (current.plan.mode === 'loop') {
      setWaypoints([waypoint(coordinate, 'start')], false);
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
  }, [setWaypoints]);

  const waypointPress = useCallback((id: string) => {
    const current = currentState.current;
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
    const seeds = loopSeeds(start, target, current.loopSeed);
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
    controller.current?.abort();
    requestId.current++;
    const plan = { ...currentState.current.plan, ...next };
    if (plan.mode === 'loop' && plan.waypoints.length) void generate(plan);
    else if (plan.waypoints.length >= 2) void calculate(plan);
  }

  function selectAlternative(id: string) {
    const alternative = state.alternatives.find((item) => item.id === id);
    if (!alternative) return;
    dispatch({ type: 'selectRoute', route: alternative.result });
    if (alternative.waypoints) dispatch({ type: 'waypoints', waypoints: alternative.waypoints });
    if (!alternative.result.edges.length) void analyze(alternative.result, routePlan(currentState.current)).then((result) => {
      if (currentState.current.selectedRoute?.id === result.id) dispatch({ type: 'selectRoute', route: result });
    });
  }

  async function locate() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      dispatch({ type: 'routeError', error: 'Location permission was unavailable or denied. Choose a start on the map instead.' });
      return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    const coordinate = { lat: position.coords.latitude, lon: position.coords.longitude };
    dispatch({ type: 'camera', center: coordinate, zoom: 15 });
    mapPress(coordinate);
  }

  const highlightedIssue = state.selectedRoute?.issues.find((issue) => issue.id === state.highlightedIssueId);
  return (
    <View style={styles.root}>
      <PlannerMap
        activity={state.plan.activity}
        activeTool={state.activeTool}
        camera={state.camera}
        waypoints={state.plan.waypoints}
        route={state.selectedRoute}
        fitRequest={fitRequest}
        alternatives={state.alternatives}
        highlightedIssue={highlightedIssue}
        profilePoint={state.profilePoint}
        onMapPress={mapPress}
        onWaypointPress={waypointPress}
        onWaypointMove={(id, coordinate) => setWaypoints(state.plan.waypoints.map((point) => point.id === id ? { ...point, coordinate } : point))}
        onIssuePress={(id) => dispatch({ type: 'highlightIssue', id })}
        onEdgePress={(index) => dispatch({ type: 'highlightEdge', index })}
        onAlternativePress={selectAlternative}
        onCameraChange={(center, zoom) => dispatch({ type: 'camera', center, zoom })}
      />
      <View pointerEvents="none" style={styles.brandPill}><Text style={styles.brand}>OPENLOOPER</Text></View>
      <PlannerSheet
        state={state}
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
        onRemove={(id) => setWaypoints(state.plan.waypoints.filter((point) => point.id !== id))}
        onClear={() => { controller.current?.abort(); requestId.current++; dispatch({ type: 'clear' }); }}
        onIssue={(issue) => dispatch({ type: 'highlightIssue', id: issue.id })}
        onEdgeDismiss={() => dispatch({ type: 'highlightEdge' })}
        onProfile={(coordinate) => dispatch({ type: 'profilePoint', coordinate })}
        onSheet={(sheet) => dispatch({ type: 'sheet', sheet })}
        onSearchSelect={(coordinate) => {
          dispatch({ type: 'camera', center: coordinate, zoom: 15 });
          const points = currentState.current.plan.waypoints;
          setWaypoints(points.length ? [{ ...points[0]!, coordinate }, ...points.slice(1)] : [waypoint(coordinate, 'start')], points.length >= 2);
        }}
        onLocate={() => void locate()}
        onExport={() => {
          if (!state.selectedRoute) return;
          void exportGpx(state.selectedRoute, state.plan.activity).catch((error) => dispatch({ type: 'routeError', error: (error as Error).message }));
        }}
        onFitRoute={() => setFitRequest((value) => value + 1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e9eee8' },
  brandPill: { position: 'absolute', top: 18, right: 18, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(250,251,247,0.94)', shadowColor: '#172019', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } },
  brand: { color: '#172019', fontSize: 11, fontWeight: '900', letterSpacing: 1.5 },
});
