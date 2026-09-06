import * as Location from 'expo-location';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { closestSegment, distanceKm, routeBounds } from '../../../../src/domain/geometry';
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
  Activity,
  Coordinate,
  CreationMode,
  InteractionMode,
  LoopScoringWeights,
  RouteAlternative,
  RoutePlan,
  RouteResult,
  Waypoint,
} from '@/domain/models';
import { waypoint } from '@/domain/models';
import type { SavedRoute } from '@/domain/saved-route';
import { closedLoop, editableWaypoints, loopAnchors, openLoop } from '@/domain/waypoints';
import { routeEvidence, routeEvidenceBatch } from '@/services/evidence';
import { persistPlanner, restorePlanner } from '@/services/persistence';
import { requestRoute, traceRoute } from '@/services/routing';
import { initialPlannerState, normalizedWaypoints, plannerReducer, routePlan } from '@/state/planner';

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

/** Where locating puts the camera: close enough to place a start on the right
 * street, wide enough to still see which part of town it is. */
export const LOCATE_ZOOM = 14;

async function attributeGeometry(result: RouteResult, plan: RoutePlan, signal?: AbortSignal) {
  const trace = await traceRoute(result, plan.activity, signal);
  const edges = mapEdges(trace.edges ?? [], result.geometry.length);
  if (!edges.length) throw new Error('Route attribution did not align to the returned route.');
  return { ...result, edges, issues: analyzeRoute(result, edges, plan.activity) };
}

/**
 * Everything the planner does to a route: routing, loop generation, editing and
 * session persistence. It lives apart from the screen so the map can stay
 * mounted underneath the home screen while the planner is closed.
 */
export function usePlanner() {
  const [state, dispatch] = useReducer(plannerReducer, initialPlannerState);
  const [restored, setRestored] = useState(false);
  const [evidenceRanking, setEvidenceRanking] = useState(true);
  const [scoringWeights, setScoringWeights] = useState<LoopScoringWeights>(DEFAULT_LOOP_SCORING_WEIGHTS);
  const [fitRequest, setFitRequest] = useState(0);
  const [locating, setLocating] = useState(false);
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

  const rerank = useCallback((enabled: boolean, weights: LoopScoringWeights) => {
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
  }, []);

  const rerouteWith = useCallback((next: Partial<RoutePlan>) => {
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
  }, [calculate, generate]);

  const selectAlternative = useCallback((id: string) => {
    const current = currentState.current;
    const alternative = current.alternatives.find((item) => item.id === id);
    if (!alternative) return;
    dispatch({ type: 'selectRoute', route: alternative.result });
    if (alternative.waypoints) {
      dispatch({ type: 'waypoints', waypoints: alternative.waypoints });
      dispatch({ type: 'loopTuned', tuned: false });
    }
    if (!alternative.result.edges.length) void analyze(alternative.result, routePlan(currentState.current)).then((result) => {
      if (currentState.current.selectedRoute?.id === result.id) dispatch({ type: 'selectRoute', route: result });
    });
  }, [analyze]);

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

  /** Removes one point, from the popup its marker opens. */
  const removeWaypoint = useCallback((id: string) => {
    const current = currentState.current;
    const points = editableWaypoints(current);
    const index = points.findIndex((point) => point.id === id);
    // A loop's start doubles as its finish, and two points are the fewest a
    // route can be described by.
    if (index <= 0 || points.length <= 2) return;
    editWaypoints(points.filter((_, position) => position !== index));
  }, [editWaypoints]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    requestId.current++;
    dispatch({ type: 'routeError', error: 'Route calculation stopped.' });
  }, []);

  const clear = useCallback(() => {
    controller.current?.abort();
    requestId.current++;
    dispatch({ type: 'clear' });
  }, []);

  const fitRoute = useCallback(() => setFitRequest((value) => value + 1), []);

  const locate = useCallback(async () => {
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
      dispatch({ type: 'camera', center: coordinate, zoom: LOCATE_ZOOM });
      startAt(coordinate);
    } catch (error) {
      dispatch({ type: 'routeError', error: `Your location is unavailable (${(error as Error).message}). Choose a start on the map instead.` });
    } finally {
      setLocating(false);
    }
  }, [startAt]);

  /** Starts a blank plan from the options chosen on the home screen, leaving the
   * camera where the map already is. */
  const startNew = useCallback(
    (activity: Activity, mode: CreationMode, targetDistanceKm: number) => {
      controller.current?.abort();
      requestId.current++;
      const current = currentState.current;
      dispatch({
        type: 'restore',
        state: {
          ...initialPlannerState,
          camera: current.camera,
          mapStyle: current.mapStyle,
          plan: { ...initialPlannerState.plan, activity, mode, targetDistanceKm },
          sheet: 'half',
        },
      });
    },
    [],
  );

  /**
   * Reopens a saved route. Segment attributes are not stored, so they are
   * fetched again in the background exactly as they are for an alternative that
   * has not been looked at yet.
   */
  const openSaved = useCallback(
    (saved: SavedRoute, interaction: InteractionMode) => {
      controller.current?.abort();
      requestId.current++;
      const [southWest, northEast] = saved.route.bounds.length
        ? saved.route.bounds
        : routeBounds(saved.route.geometry);
      dispatch({
        type: 'restore',
        state: {
          ...initialPlannerState,
          camera: {
            center: {
              lat: (southWest.lat + northEast.lat) / 2,
              lon: (southWest.lon + northEast.lon) / 2,
            },
            zoom: currentState.current.camera.zoom,
          },
          mapStyle: currentState.current.mapStyle,
          interaction,
          plan: saved.plan,
          selectedRoute: saved.route,
          alternatives: [{ id: `saved-${saved.id}`, result: saved.route, label: 'Saved route' }],
          // A saved loop is a shape being tuned, not one waiting to be
          // generated, so a preference change reroutes it rather than replacing
          // it with a fresh set of loops.
          loopTuned: saved.plan.mode === 'loop',
          sketchCompleted: saved.plan.mode === 'sketch',
          activeTool: 'add',
          sheet: 'collapsed',
        },
      });
      setFitRequest((value) => value + 1);
      void analyze(saved.route, saved.plan).then((result) => {
        if (currentState.current.selectedRoute?.id === result.id)
          dispatch({ type: 'selectRoute', route: result });
      });
    },
    [analyze],
  );

  return {
    state,
    dispatch,
    restored,
    evidenceRanking,
    scoringWeights,
    fitRequest,
    fitRoute,
    locating,
    locate,
    mapPress,
    waypointPress,
    moveWaypoint,
    startAt,
    editWaypoints,
    removeWaypoint,
    setWaypoints,
    selectAlternative,
    generate,
    rerank,
    rerouteWith,
    cancel,
    clear,
    startNew,
    openSaved,
  };
}
