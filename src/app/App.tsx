import { Crosshair, LocateFixed, Maximize2 } from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { closestSegment, distanceKm, routeBounds } from "../domain/geometry";
import { CONTOUR_FRACTIONS, loopSeeds, scaleLoop } from "../domain/loops";
import type {
  Coordinate,
  RouteAlternative,
  RouteIssue,
  RoutePlan,
  RouteResult,
  LoopScoringWeights,
  ViewportEvidenceState,
  Waypoint,
} from "../domain/models";
import { waypoint } from "../domain/models";
import {
  evidenceStatus,
  routeUseEvidence,
  routeUseEvidenceBatch,
  type EvidenceStatus,
} from "../evidence/evidence-client";
import { analyzeRoute, mapEdges } from "../domain/route-analysis";
import {
  LOOP_LIMITS,
  rankCandidates,
  repetitionDescription,
  routeSimilarity,
  scoreRoute,
  scoringWeightsFor,
} from "../domain/route-scoring";
import { characterDescription } from "../domain/vocabulary";
import { RouteMap } from "../map/RouteMap";
import {
  distanceContour,
  routePlan as requestRoute,
  traceRoute,
} from "../routing/valhalla-client";
import { LocationSearch } from "../ui/LocationSearch";
import { PlannerSheet } from "../ui/PlannerSheet";
import { EvidenceControls } from "../ui/EvidenceControls";
import { persist, restore } from "./persistence";
import { normalizedWaypoints, reducer, routePlan } from "./state";

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
        output[index] = {
          status: "fulfilled",
          value: await work(items[index]!, index),
        };
      } catch (reason) {
        output[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return output;
}

function focusedRoute(route: RouteResult, issue: RouteIssue): RouteResult {
  return { ...route, bounds: routeBounds(issue.geometry) };
}

function loopLabel(
  result: RouteResult,
  metrics: NonNullable<RouteAlternative["metrics"]>,
) {
  return [
    `${Math.round(metrics.distanceError * 100)}% target error`,
    repetitionDescription(metrics.repeatedCoverage),
    characterDescription(metrics.character),
    result.useEvidence?.status === "available"
      ? `${Math.round(result.useEvidence.evidencedDistancePct)}% evidenced distance`
      : "evidenced distance unavailable",
  ].join(" · ");
}

async function attributeRouteGeometry(
  result: RouteResult,
  plan: RoutePlan,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const trace = await traceRoute(result, plan.activity, signal);
  const edges = mapEdges(trace.edges ?? [], result.geometry.length);
  if (!edges.length)
    throw new Error("Route attribution did not align to the returned route.");
  return {
    ...result,
    edges,
    issues: analyzeRoute(result, edges, plan.activity),
  };
}

async function attributeRoute(
  result: RouteResult,
  plan: RoutePlan,
  signal?: AbortSignal,
): Promise<RouteResult> {
  const attributed = await attributeRouteGeometry(result, plan, signal);
  return {
    ...attributed,
    useEvidence: await routeUseEvidence(
      attributed,
      attributed.edges,
      false,
      signal,
    ),
  };
}

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, restore);
  const [evidenceService, setEvidenceService] = useState<EvidenceStatus>();
  const [viewportEvidenceSource, setViewportEvidenceSource] = useState<string>();
  const [selectedRouteEvidence, setSelectedRouteEvidence] = useState(false);
  const [evidenceRanking, setEvidenceRanking] = useState(true);
  const evidenceRankingRef = useRef(true);
  const [scoringWeights, setScoringWeights] = useState<LoopScoringWeights>(
    scoringWeightsFor(state.plan.activity),
  );
  const scoringWeightsRef = useRef(scoringWeights);
  const [viewportEvidenceState, setViewportEvidenceState] =
    useState<ViewportEvidenceState>({ loading: false, count: 0 });
  const activity = state.plan.activity;
  // What counts as a good route differs by activity, so the weights follow it.
  // Any development-only override is deliberately dropped on the change.
  useEffect(() => {
    const weights = scoringWeightsFor(activity);
    scoringWeightsRef.current = weights;
    setScoringWeights(weights);
  }, [activity]);
  const requestId = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const evidenceOverlayController = useRef<AbortController | undefined>(
    undefined,
  );
  const mapApi = useRef<{
    fit: (route?: RouteResult) => void;
    fly: (coordinate: Coordinate, zoom?: number) => void;
  } | null>(null);
  const currentState = useRef(state);
  currentState.current = state;

  useEffect(() => {
    const timer = window.setTimeout(() => persist(state), 350);
    return () => window.clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    const abort = new AbortController();
    void evidenceStatus(abort.signal)
      .then(setEvidenceService)
      .catch(() => setEvidenceService(undefined));
    return () => abort.abort();
  }, []);

  const loadEvidenceSegments = useCallback(async (route: RouteResult) => {
    if (!route.edges.length || route.useEvidence?.segments) return;
    evidenceOverlayController.current?.abort();
    const abort = new AbortController();
    evidenceOverlayController.current = abort;
    const evidence = await routeUseEvidence(
      route,
      route.edges,
      true,
      abort.signal,
    );
    if (abort.signal.aborted) return;
    const current = currentState.current;
    if (current.selectedRoute?.id !== route.id) return;
    const updated = { ...route, useEvidence: evidence };
    const alternatives = current.alternatives.map((alternative) =>
      alternative.result.id === route.id
        ? { ...alternative, result: updated }
        : alternative,
    );
    if (alternatives.some((alternative) => alternative.result.id === route.id))
      dispatch({
        type: "alternatives",
        alternatives,
        preserveSelection: true,
      });
    else dispatch({ type: "selectRoute", route: updated });
  }, []);

  useEffect(() => {
    const route = state.selectedRoute;
    if (
      selectedRouteEvidence &&
      route?.useEvidence?.status === "available" &&
      !route.useEvidence.segments
    )
      void loadEvidenceSegments(route);
  }, [loadEvidenceSegments, selectedRouteEvidence, state.selectedRoute]);

  const analyze = useCallback(
    async (result: RouteResult, plan: RoutePlan, signal?: AbortSignal) => {
      try {
        return await attributeRoute(result, plan, signal);
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        return {
          ...result,
          useEvidence: {
            status: "unavailable" as const,
            evidencedDistanceKm: 0,
            evidencedDistancePct: 0,
          },
        };
      }
    },
    [],
  );

  const calculate = useCallback(
    async (plan: RoutePlan, fit = true) => {
      if (plan.waypoints.length < 2) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const id = ++requestId.current;
      dispatch({ type: "routeStart" });
      try {
        const routes = await requestRoute(plan, abort.signal, true);
        const selected = await analyze(routes[0]!, plan, abort.signal);
        if (id !== requestId.current) return;
        const alternatives: RouteAlternative[] = routes.map(
          (result, index) => ({
            id: `route-${result.id}`,
            result: index === 0 ? selected : result,
            label:
              index === 0 ? "Suggested route" : "Alternative from Valhalla",
          }),
        );
        dispatch({ type: "routeSuccess", route: selected, alternatives });
        if (fit) requestAnimationFrame(() => mapApi.current?.fit(selected));
      } catch (error) {
        if ((error as Error).name !== "AbortError" && id === requestId.current)
          dispatch({ type: "routeError", error: (error as Error).message });
      }
    },
    [analyze],
  );

  const setWaypoints = useCallback(
    (points: Waypoint[], recalculate = true) => {
      const clean = normalizedWaypoints(points);
      dispatch({ type: "waypoints", waypoints: clean });
      if (recalculate && clean.length >= 2)
        void calculate(routePlan(currentState.current, clean), false);
    },
    [calculate],
  );

  const mapClick = useCallback(
    (coordinate: Coordinate) => {
      const current = currentState.current;
      const points = current.plan.waypoints;
      if (current.plan.mode === "loop") {
        setWaypoints([waypoint(coordinate, "start")], false);
        return;
      }
      if (current.activeTool === "add" && current.selectedRoute) {
        const segment = closestSegment(
          current.selectedRoute.geometry,
          coordinate,
        );
        const legIndex = current.selectedRoute.legs.findIndex(
          (leg) => segment <= leg.endIndex,
        );
        const insertion = legIndex >= 0 ? legIndex + 1 : points.length - 1;
        setWaypoints([
          ...points.slice(0, insertion),
          waypoint(coordinate, "via"),
          ...points.slice(insertion),
        ]);
        return;
      }
      if (current.plan.mode === "sketch") {
        if (current.sketchCompleted) return;
        if (!points.length)
          setWaypoints([waypoint(coordinate, "start")], false);
        else if (points.length === 1)
          setWaypoints([...points, waypoint(coordinate, "destination")]);
        else {
          const previousEnd = points.at(-1)!;
          setWaypoints([
            ...points.slice(0, -1),
            { ...previousEnd, role: "via" },
            waypoint(coordinate, "destination"),
          ]);
        }
        return;
      }
      if (current.activeTool === "start") {
        const next = points.length
          ? [waypoint(coordinate, "start"), ...points.slice(1)]
          : [waypoint(coordinate, "start")];
        setWaypoints(next, next.length >= 2);
        dispatch({ type: "tool", tool: "destination" });
      } else if (current.activeTool === "destination") {
        const next =
          points.length > 1
            ? [
                points[0]!,
                ...points.slice(1, -1),
                waypoint(coordinate, "destination"),
              ]
            : [...points, waypoint(coordinate, "destination")];
        setWaypoints(next);
      }
    },
    [setWaypoints],
  );

  const moveWaypoint = useCallback(
    (id: string, coordinate: Coordinate, finished: boolean) => {
      if (finished)
        setWaypoints(
          currentState.current.plan.waypoints.map((point) =>
            point.id === id ? { ...point, coordinate } : point,
          ),
        );
    },
    [setWaypoints],
  );

  const selectWaypoint = useCallback(
    (id: string) => {
      const current = currentState.current;
      if (current.plan.mode !== "sketch" || current.sketchCompleted) return;
      const points = current.plan.waypoints;
      if (points.length < 2) return;
      const first = points[0]!;
      const last = points.at(-1)!;
      if (
        !points.some(
          (point) => distanceKm(first.coordinate, point.coordinate) >= 0.001,
        )
      )
        return;
      if (id === last.id) {
        dispatch({ type: "finishSketch" });
        return;
      }
      if (id === first.id) {
        setWaypoints([
          ...points.slice(0, -1),
          { ...last, role: "via" },
          waypoint(first.coordinate, "destination"),
        ]);
        dispatch({ type: "finishSketch" });
      }
    },
    [setWaypoints],
  );

  const generate = useCallback(async () => {
    const current = currentState.current;
    const start = current.plan.waypoints[0]?.coordinate;
    const target = current.plan.targetDistanceKm ?? 10;
    if (!start || target < 1) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    dispatch({ type: "routeStart", progress: "Measuring how far you can get…" });
    const basePlan = { ...current.plan, mode: "loop" as const };
    try {
      // One request describes how far the network actually reaches in every
      // direction, which is what the shaping points are then placed on.
      const [triangle, diamond] = await Promise.all(
        [CONTOUR_FRACTIONS.triangle, CONTOUR_FRACTIONS.diamond].map((fraction) =>
          distanceContour(
            start,
            target / fraction,
            basePlan.activity,
            basePlan.preferences,
            abort.signal,
          ),
        ),
      );
      const seeds = loopSeeds(start, target, current.loopSeed, [], {
        triangle,
        diamond,
      });
      dispatch({ type: "progress", progress: "Trying 12 loop shapes…" });
      const initial = await pool(
        seeds,
        LOOP_LIMITS.seedConcurrency,
        async (seed) => {
          if (abort.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          const [result] = await requestRoute(
            { ...basePlan, waypoints: seed.waypoints },
            abort.signal,
            false,
          );
          return { seed, result: result! };
        },
      );
      const refinementLimit = target > 20 ? 6 : target > 10 ? 8 : seeds.length;
      const promising = rankCandidates(
        initial.flatMap((item) =>
          item.status === "fulfilled" ? [item.value] : [],
        ),
        target,
        basePlan.activity,
        scoringWeightsRef.current,
      ).slice(0, refinementLimit);
      dispatch({
        type: "progress",
        progress: `Refining ${promising.length} promising loops…`,
      });
      const refined = await pool(
        promising,
        LOOP_LIMITS.refineConcurrency,
        async ({ seed, result, metrics }) => {
          if (metrics.distanceError <= 0.03) return { seed, result };
          const factor = Math.max(
            LOOP_LIMITS.refinementMin,
            Math.min(LOOP_LIMITS.refinementMax, target / result.distanceKm),
          );
          const adjusted = scaleLoop(seed, start, factor);
          const [route] = await requestRoute(
            { ...basePlan, waypoints: adjusted.waypoints },
            abort.signal,
            false,
          );
          return { seed: adjusted, result: route! };
        },
      );
      const shortlist = rankCandidates(
        refined.flatMap((item) =>
          item.status === "fulfilled" ? [item.value] : [],
        ),
        target,
        basePlan.activity,
        scoringWeightsRef.current,
      ).slice(0, 6);
      dispatch({
        type: "progress",
        progress: "Checking route surfaces and issues…",
      });
      const attributed = await pool(
        shortlist,
        LOOP_LIMITS.traceConcurrency,
        async (item) => ({
          ...item,
          result: await attributeRouteGeometry(
            item.result,
            basePlan,
            abort.signal,
          ),
        }),
      );
      const attributedRoutes = attributed.flatMap((item) =>
        item.status === "fulfilled" ? [item.value] : [],
      );
      dispatch({
        type: "progress",
        progress: "Checking route-use evidence…",
      });
      const evidenceById = attributedRoutes.length
        ? await routeUseEvidenceBatch(
            attributedRoutes.map((item) => ({
              id: item.result.id,
              route: item.result,
              edges: item.result.edges,
            })),
            abort.signal,
          )
        : new Map<string, NonNullable<RouteResult["useEvidence"]>>();
      const ranked = attributedRoutes
        .map((item) => ({
          ...item,
          result: {
            ...item.result,
            useEvidence: evidenceById.get(item.result.id),
          },
        }))
        .map((item) => ({
          ...item,
          metrics: scoreRoute(
            item.result,
            target,
            item.result.issues,
            basePlan.activity,
            evidenceRankingRef.current,
            scoringWeightsRef.current,
          ),
        }))
        .sort((a, b) => b.metrics.score - a.metrics.score);
      const distinct: typeof ranked = [];
      for (const item of ranked) {
        if (
          distinct.every(
            (other) =>
              routeSimilarity(item.result.geometry, other.result.geometry) <=
              LOOP_LIMITS.dedupeSimilarity,
          )
        )
          distinct.push(item);
        if (distinct.length === 3) break;
      }
      if (id !== requestId.current) return;
      if (!distinct.length)
        throw new Error(
          "No useful loops survived around this start. Try a different distance, preference, or start point.",
        );
      const alternatives: RouteAlternative[] = distinct.map((item) => ({
        id: item.seed.id,
        result: item.result,
        metrics: item.metrics,
        waypoints: item.seed.waypoints,
        label: loopLabel(item.result, item.metrics),
      }));
      dispatch({ type: "waypoints", waypoints: alternatives[0]!.waypoints! });
      dispatch({ type: "alternatives", alternatives });
      if (distinct.length < 3)
        dispatch({
          type: "routeError",
          error: `Found ${distinct.length} distinct loop${distinct.length === 1 ? "" : "s"}; the local network shape limited generation.`,
        });
      requestAnimationFrame(() => mapApi.current?.fit(alternatives[0]!.result));
    } catch (error) {
      if ((error as Error).name !== "AbortError" && id === requestId.current)
        dispatch({ type: "routeError", error: (error as Error).message });
    }
  }, []);

  function selectAlternative(id: string) {
    const alternative = state.alternatives.find((item) => item.id === id);
    if (!alternative) return;
    dispatch({ type: "selectRoute", route: alternative.result });
    if (alternative.waypoints)
      dispatch({ type: "waypoints", waypoints: alternative.waypoints });
    if (!alternative.result.edges.length)
      void analyze(alternative.result, routePlan(currentState.current)).then(
        (result) => {
          if (currentState.current.selectedRoute?.id === result.id)
            dispatch({ type: "selectRoute", route: result });
        },
      );
    mapApi.current?.fit(alternative.result);
  }

  function rerankAlternatives(enabled: boolean, weights: LoopScoringWeights) {
    evidenceRankingRef.current = enabled;
    setEvidenceRanking(enabled);
    scoringWeightsRef.current = weights;
    setScoringWeights(weights);
    const current = currentState.current;
    if (current.plan.mode !== "loop" || !current.alternatives.length) return;
    const target = current.plan.targetDistanceKm ?? 10;
    const reordered = current.alternatives
      .map((alternative) => {
        const metrics = scoreRoute(
          alternative.result,
          target,
          alternative.result.issues,
          current.plan.activity,
          enabled,
          weights,
        );
        return {
          ...alternative,
          metrics,
          label: loopLabel(alternative.result, metrics),
        };
      })
      .sort((a, b) => (b.metrics?.score ?? 0) - (a.metrics?.score ?? 0));
    dispatch({
      type: "alternatives",
      alternatives: reordered,
      preserveSelection: true,
    });
  }

  function changeEvidenceRanking(enabled: boolean) {
    rerankAlternatives(enabled, scoringWeightsRef.current);
  }

  function changeScoringWeights(weights: LoopScoringWeights) {
    rerankAlternatives(evidenceRankingRef.current, weights);
  }

  function locate() {
    if (!navigator.geolocation) {
      dispatch({
        type: "routeError",
        error: "Location is unavailable. Choose a start on the map.",
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinate = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        };
        mapApi.current?.fly(coordinate);
        mapClick(coordinate);
      },
      () =>
        dispatch({
          type: "routeError",
          error:
            "Location permission was unavailable or denied. Choose a start on the map instead.",
        }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  function rerouteWith(next: Partial<RoutePlan>) {
    controller.current?.abort();
    requestId.current++;
    const plan = { ...state.plan, ...next };
    if (plan.mode === "loop" && plan.waypoints.length) window.setTimeout(() => void generate(), 0);
    else if (plan.waypoints.length >= 2) void calculate(plan, false);
  }
  function selectIssue(issue: RouteIssue) {
    dispatch({ type: "highlightIssue", id: issue.id });
    if (state.selectedRoute)
      mapApi.current?.fit(focusedRoute(state.selectedRoute, issue));
  }

  return (
    <main>
      <RouteMap
        state={state}
        onMapClick={mapClick}
        onWaypointMove={moveWaypoint}
        onWaypointSelect={selectWaypoint}
        onCamera={(center, zoom) => dispatch({ type: "camera", center, zoom })}
        onIssueSelect={(id) => {
          const issue = state.selectedRoute?.issues.find(
            (item) => item.id === id,
          );
          if (issue) selectIssue(issue);
        }}
        onEdgeSelect={(index) => dispatch({ type: "highlightEdge", index })}
        mapApiRef={mapApi}
        viewportEvidenceSource={viewportEvidenceSource}
        showSelectedRouteEvidence={selectedRouteEvidence}
        onViewportEvidenceState={setViewportEvidenceState}
      />
      <div className="top-controls">
        <LocationSearch
          viewbox={[
            {
              lat: state.camera.center.lat - 90 / 2 ** state.camera.zoom,
              lon: state.camera.center.lon - 180 / 2 ** state.camera.zoom,
            },
            {
              lat: state.camera.center.lat + 90 / 2 ** state.camera.zoom,
              lon: state.camera.center.lon + 180 / 2 ** state.camera.zoom,
            },
          ]}
          onSelect={(coordinate) => {
            mapApi.current?.fly(coordinate);
            const points = state.plan.waypoints;
            setWaypoints(
              points.length
                ? [{ ...points[0]!, coordinate }, ...points.slice(1)]
                : [waypoint(coordinate, "start")],
              points.length >= 2,
            );
          }}
        />
      </div>
      <div className="map-actions">
        <button onClick={locate} title="Locate me">
          <LocateFixed />
        </button>
        <button
          onClick={() => mapApi.current?.fit(state.selectedRoute)}
          disabled={!state.selectedRoute}
          title="Fit route"
        >
          <Maximize2 />
        </button>
        <button
          onClick={() =>
            mapApi.current?.fly(state.camera.center, state.camera.zoom)
          }
          title="Recenter"
        >
          <Crosshair />
        </button>
      </div>
      {state.sheet === "collapsed" && (
        <button
          className="collapsed-route"
          onClick={() => dispatch({ type: "sheet", sheet: "half" })}
        >
          <span>
            <b>
              {state.plan.activity[0]!.toUpperCase() +
                state.plan.activity.slice(1)}
            </b>{" "}
            ·{" "}
            {state.selectedRoute
              ? `${state.selectedRoute.distanceKm.toFixed(1)} km · ${Math.round(state.selectedRoute.durationSeconds / 60)} min`
              : state.loading
                ? "Calculating route…"
                : "Tap to plan"}
          </span>
          <strong>Plan & details</strong>
        </button>
      )}
      <PlannerSheet
        state={state}
        onMode={(mode) => dispatch({ type: "mode", mode })}
        onActivity={(activity) => {
          dispatch({ type: "activity", activity });
          rerouteWith({ activity });
        }}
        onPreferences={(preferences) => {
          dispatch({ type: "preferences", preferences });
          rerouteWith({ preferences });
        }}
        onTool={(tool) => dispatch({ type: "tool", tool })}
        onGenerate={generate}
        onCancel={() => {
          controller.current?.abort();
          requestId.current++;
          dispatch({
            type: "routeError",
            error: "Route calculation stopped.",
          });
        }}
        onRegenerate={() => {
          dispatch({ type: "loopSeed" });
          window.setTimeout(() => void generate(), 0);
        }}
        onSelectAlternative={selectAlternative}
        onReverse={() => setWaypoints([...state.plan.waypoints].reverse())}
        onRemove={(id) =>
          setWaypoints(state.plan.waypoints.filter((point) => point.id !== id))
        }
        onClear={() => {
          controller.current?.abort();
          requestId.current++;
          dispatch({ type: "clear" });
        }}
        onIssue={selectIssue}
        onProfile={(coordinate) =>
          dispatch({ type: "profilePoint", coordinate })
        }
        onEdgeDismiss={() => dispatch({ type: "highlightEdge" })}
        onSheet={(sheet) => dispatch({ type: "sheet", sheet })}
        onTarget={(distanceKm) => dispatch({ type: "target", distanceKm })}
        evidenceControls={
          <EvidenceControls
            status={evidenceService}
            viewportSource={viewportEvidenceSource}
            onViewportSource={setViewportEvidenceSource}
            viewportState={viewportEvidenceState}
            selectedRouteEvidence={selectedRouteEvidence}
            onSelectedRouteEvidence={setSelectedRouteEvidence}
            evidenceRanking={evidenceRanking}
            onEvidenceRanking={changeEvidenceRanking}
            scoringWeights={scoringWeights}
            onScoringWeights={changeScoringWeights}
            hasRoute={Boolean(state.selectedRoute)}
          />
        }
      />
    </main>
  );
}
