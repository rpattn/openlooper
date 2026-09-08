import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type {
  Activity,
  Coordinate,
  CreationMode,
  InteractionMode,
  PlannerState,
  RoutePlan,
} from '@/domain/models';
import { ACTIVITY } from '@/domain/models';
import { distanceMarkers } from '@/domain/distance-markers';
import { distanceAlong } from '@/domain/route-positions';
import { overlayRender, overlaySpans } from '../../../../src/domain/route-overlays';
import { convertSeries, routeSeries } from '../../../../src/domain/route-series';
import type { SavedRoutePage } from '@/domain/saved-route';
import { savedRoute, suggestedName } from '@/domain/saved-route';
import { HomeScreen } from '@/components/home-screen';
import { MapControls } from '@/components/map-controls';
import { RouteBar } from '@/components/route-bar';
import { SHEET_FRACTION, sheetHeightFor } from '@/components/sheet-detents';
import { PlannerMap } from '@/components/planner-map';
import { DESKTOP_PANEL, PlannerSheet } from '@/components/planner-sheet';
import { Dialog } from '@/components/ui/dialog';
import { exportGpx } from '@/services/gpx';
import { deleteRoute, listRoutes, loadRoute, putRoute } from '@/services/route-store';
import { initialPlannerState } from '@/state/planner';
import { usePlanner } from '@/state/use-planner';
import { useUnits } from '@/state/settings-context';
import { useViewportEvidence, type Bounds } from '@/state/use-viewport-evidence';

const PAGE_SIZE = 4;
const OPEN = { duration: 420, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 380, easing: Easing.inOut(Easing.cubic) };

/**
 * What counts as a change worth keeping. Comparing this against the value taken
 * when the route was opened is what makes leaving the map ask before it throws
 * an edit away.
 */
function signature(plan: RoutePlan, routeId?: string) {
  return JSON.stringify({
    routeId,
    mode: plan.mode,
    activity: plan.activity,
    target: plan.targetDistanceKm,
    preferences: plan.preferences,
    points: plan.waypoints.map((point) => [
      point.role,
      point.coordinate.lat.toFixed(6),
      point.coordinate.lon.toFixed(6),
    ]),
  });
}

export default function PlannerScreen() {
  const router = useRouter();
  const units = useUnits();
  const planner = usePlanner();
  const { state, dispatch } = planner;
  const { height: windowHeight, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const desktop = width >= 800;

  const [view, setView] = useState<'home' | 'planner'>('home');
  // 0 keeps the home page over the map; 1 has slid it away to reveal it.
  const reveal = useSharedValue(0);

  // What a new route is created with, kept on the home screen rather than in
  // the planner so the map screen has nothing but the route on it.
  const [activity, setActivity] = useState<Activity>(initialPlannerState.plan.activity);
  const [mode, setMode] = useState<CreationMode>(initialPlannerState.plan.mode);
  const [targetKm, setTargetKm] = useState(10);

  const [page, setPage] = useState<SavedRoutePage>();
  const [pageIndex, setPageIndex] = useState(0);
  const [reload, setReload] = useState(0);
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [routesError, setRoutesError] = useState<string>();

  /** The library entry the open route came from, so saving updates it. */
  const [editing, setEditing] = useState<{ id: string; createdAt: number; name: string }>();
  const [baseline, setBaseline] = useState('');
  const [dialog, setDialog] = useState<'save' | 'discard'>();
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  /** An unsaved route recovered from the last run, offered once on the home page. */
  const [draft, setDraft] = useState(false);
  const checkedDraft = useRef(false);

  /** Recorded use drawn under the map while planning, rather than only as a
   * colouring of a route already chosen. */
  const [underlay, setUnderlay] = useState(false);
  const [bounds, setBounds] = useState<Bounds>();
  const evidence = useViewportEvidence(underlay && view === 'planner', bounds);

  // Roughly how much of the map the sheet covers, used both to fit routes clear
  // of it and to centre a located point in the strip that stays visible.
  const sheetInset = useCallback(
    (sheet: PlannerState['sheet']) => (desktop ? 32 : sheetHeightFor(sheet, windowHeight)),
    [desktop, windowHeight],
  );
  const bottomInset = sheetInset(state.sheet);
  /** What the desktop panel covers on the left, so routes are framed beside it
   * rather than behind it. */
  const leftInset = desktop ? DESKTOP_PANEL.left + DESKTOP_PANEL.width : 0;
  // Drives the floating controls so they ride above the sheet as it is dragged.
  // Seeded at the half detent the planner opens on, so nothing jumps on mount.
  const sheetHeight = useSharedValue(windowHeight * SHEET_FRACTION.half);

  useEffect(() => {
    // The desktop panel sits beside the map, so the controls only clear the
    // safe area rather than tracking a sheet.
    if (desktop) sheetHeight.value = insets.bottom;
  }, [desktop, insets.bottom, sheetHeight]);

  // Keyboard editing, on the one platform that has a keyboard. Undo is the
  // shortcut people reach for without being told it exists, so it is the one
  // worth having even though every action is also a button.
  useEffect(() => {
    if (Platform.OS !== 'web' || view !== 'planner') return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Never steal a key from the search field or the save dialog.
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? ''))
        return;
      const accel = event.metaKey || event.ctrlKey;
      if (accel && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) planner.redo();
        else planner.undo();
        return;
      }
      if (accel && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        planner.redo();
        return;
      }
      if (event.key === 'Escape') {
        dispatch({ type: 'highlightEdge' });
        dispatch({ type: 'highlightIssue' });
        dispatch({ type: 'profilePoint' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch, planner, view]);

  useEffect(() => {
    if (!planner.restored || checkedDraft.current) return;
    checkedDraft.current = true;
    if (planner.state.selectedRoute) setDraft(true);
  }, [planner.restored, planner.state.selectedRoute]);

  const refresh = useCallback(async (index: number) => {
    setLoadingRoutes(true);
    try {
      const result = await listRoutes(index * PAGE_SIZE, PAGE_SIZE);
      setRoutesError(undefined);
      // Deleting the last route on a page empties it; step back onto the one
      // before rather than showing nothing.
      if (!result.items.length && index > 0) setPageIndex(index - 1);
      else setPage(result);
    } catch (error) {
      setRoutesError(`Saved routes are unavailable on this device (${(error as Error).message}).`);
    } finally {
      setLoadingRoutes(false);
    }
  }, []);

  useEffect(() => {
    void refresh(pageIndex);
  }, [pageIndex, refresh, reload]);

  const enterPlanner = useCallback(() => {
    setView('planner');
    reveal.value = withTiming(1, OPEN);
  }, [reveal]);

  const leavePlanner = useCallback(() => {
    setDialog(undefined);
    setView('home');
    reveal.value = withTiming(0, CLOSE);
  }, [reveal]);

  function createRoute() {
    planner.startNew(activity, mode, targetKm);
    setEditing(undefined);
    setDraft(false);
    setBaseline(
      signature({ ...initialPlannerState.plan, activity, mode, targetDistanceKm: targetKm }),
    );
    enterPlanner();
  }

  function resumeDraft() {
    setEditing(undefined);
    setDraft(false);
    // A recovered route was never saved, so leaving it must still ask.
    setBaseline('');
    enterPlanner();
  }

  async function openRoute(id: string, interaction: InteractionMode) {
    try {
      const saved = await loadRoute(id);
      if (!saved) {
        setRoutesError('That route is no longer saved on this device.');
        setReload((value) => value + 1);
        return;
      }
      setEditing({ id: saved.id, createdAt: saved.createdAt, name: saved.name });
      setBaseline(signature(saved.plan, saved.route.id));
      setDraft(false);
      setActivity(saved.plan.activity);
      setMode(saved.plan.mode);
      if (saved.plan.targetDistanceKm) setTargetKm(saved.plan.targetDistanceKm);
      planner.openSaved(saved, interaction);
      enterPlanner();
    } catch (error) {
      setRoutesError(`That route could not be opened (${(error as Error).message}).`);
    }
  }

  async function removeRoute(id: string) {
    try {
      await deleteRoute(id);
      if (editing?.id === id) setEditing(undefined);
      setReload((value) => value + 1);
    } catch (error) {
      setRoutesError(`That route could not be deleted (${(error as Error).message}).`);
    }
  }

  function beginSave() {
    if (!state.selectedRoute) return;
    setNameDraft(editing?.name ?? suggestedName(state.plan, state.selectedRoute));
    setDialog('save');
  }

  async function commitSave() {
    const route = state.selectedRoute;
    if (!route) return;
    setSaving(true);
    try {
      const record = savedRoute(nameDraft, state.plan, route, editing);
      await putRoute(record);
      setEditing({ id: record.id, createdAt: record.createdAt, name: record.name });
      setBaseline(signature(state.plan, route.id));
      setPageIndex(0);
      setReload((value) => value + 1);
      leavePlanner();
    } catch (error) {
      setDialog(undefined);
      dispatch({ type: 'routeError', error: `This route could not be saved (${(error as Error).message}).` });
    } finally {
      setSaving(false);
    }
  }

  function requestBack() {
    if (dirty && (state.selectedRoute || state.plan.waypoints.length)) {
      setDialog('discard');
      return;
    }
    discard();
  }

  function discard() {
    planner.clear();
    setEditing(undefined);
    setDraft(false);
    leavePlanner();
  }

  const dirty = signature(state.plan, state.selectedRoute?.id) !== baseline;

  const highlightedIssue = state.selectedRoute?.issues.find(
    (issue) => issue.id === state.highlightedIssueId,
  );
  const overlay = useMemo(
    () =>
      state.selectedRoute
        ? overlayRender(
            state.selectedRoute,
            state.overlay,
            ACTIVITY[state.plan.activity].color,
            units,
          )
        : { bands: [], legend: [] },
    [state.overlay, state.plan.activity, state.selectedRoute, units],
  );
  const series = useMemo(
    () => convertSeries(routeSeries(state.selectedRoute, state.overlay), units),
    [state.overlay, state.selectedRoute, units],
  );
  const spans = useMemo(
    () => (state.selectedRoute ? overlaySpans(state.selectedRoute, overlay.bands) : []),
    [overlay.bands, state.selectedRoute],
  );
  // Marks only belong on the plain route: over a colouring they compete with the
  // thing being read, and the colouring already has a legend of its own.
  const marks = useMemo(
    () => distanceMarkers(state.selectedRoute, units),
    [state.selectedRoute, units],
  );
  const markers = state.overlay === 'route' ? marks : [];

  /** Puts the profile cursor wherever the route was touched, so reading the map
   * and reading the chart are the same act from either end. */
  const placeProfile = useCallback(
    (coordinate?: Coordinate, distanceKm?: number) => {
      if (!coordinate) {
        dispatch({ type: 'profilePoint' });
        return;
      }
      const route = state.selectedRoute;
      dispatch({
        type: 'profilePoint',
        coordinate,
        distanceKm: distanceKm ?? (route ? distanceAlong(route.geometry, coordinate) : undefined),
      });
    },
    [dispatch, state.selectedRoute],
  );

  // The map never unmounts, so opening a route slides the home page down off it
  // rather than loading a screen with a second map on it.
  const homeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: reveal.value * windowHeight }],
  }));
  const plannerStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ translateY: (1 - reveal.value) * 20 }],
  }));

  return (
    <View style={styles.root}>
      <PlannerMap
        activeTool={state.activeTool}
        interaction={state.interaction}
        bands={overlay.bands}
        showIssues={state.overlay === 'route'}
        camera={state.camera}
        mapStyle={state.mapStyle}
        bottomInset={view === 'planner' ? bottomInset : 0}
        leftInset={view === 'planner' ? leftInset : 0}
        waypoints={state.plan.waypoints}
        mode={state.plan.mode}
        active={view === 'planner'}
        route={state.selectedRoute}
        fitRequest={planner.fitRequest}
        alternatives={state.alternatives}
        highlightedIssue={highlightedIssue}
        profilePoint={state.profilePoint}
        markers={markers}
        evidenceSections={evidence.sections}
        onMapPress={planner.mapPress}
        onWaypointPress={planner.waypointPress}
        onWaypointDelete={planner.removeWaypoint}
        onWaypointMove={planner.moveWaypoint}
        onIssuePress={(id) => dispatch({ type: 'highlightIssue', id })}
        onEdgePress={(index, coordinate) => {
          dispatch({ type: 'highlightEdge', index });
          // Touching the route also says where on the profile that is, so the
          // chart and the map each answer for the other.
          const edge = state.selectedRoute?.edges[index];
          const middle =
            coordinate ??
            (edge && state.selectedRoute
              ? state.selectedRoute.geometry[
                  Math.floor((edge.beginIndex + edge.endIndex) / 2)
                ]
              : undefined);
          if (middle) placeProfile(middle);
        }}
        onRouteDrag={planner.dragRouteTo}
        onBoundsChange={setBounds}
        onAlternativePress={planner.selectAlternative}
        onCameraChange={(center, zoom) => dispatch({ type: 'camera', center, zoom })}
      />

      <Animated.View
        style={[StyleSheet.absoluteFill, styles.plannerLayer, plannerStyle]}
        pointerEvents={view === 'planner' ? 'box-none' : 'none'}
        // Both layers stay mounted so the map is never rebuilt, so the one that
        // is not on screen has to be taken out of the accessibility tree too.
        aria-hidden={view !== 'planner'}
        accessibilityElementsHidden={view !== 'planner'}
        importantForAccessibility={view === 'planner' ? 'auto' : 'no-hide-descendants'}
      >
        <RouteBar
          top={insets.top + 8}
          name={editing?.name}
          canSave={Boolean(state.selectedRoute) && dirty}
          saving={saving}
          onBack={requestBack}
          onSave={beginSave}
        />
        <MapControls
          accent={ACTIVITY[state.plan.activity].color}
          mapStyle={state.mapStyle}
          offset={sheetHeight}
          gap={14}
          leftInset={desktop ? leftInset + DESKTOP_PANEL.gap : 14}
          fadeAt={windowHeight * SHEET_FRACTION.full}
          overlay={state.overlay}
          legend={overlay.legend}
          onOverlay={(value) => dispatch({ type: 'overlay', overlay: value })}
          locating={planner.locating}
          hasRoute={Boolean(state.selectedRoute)}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onUndo={planner.undo}
          onRedo={planner.redo}
          markSpacing={markers.length ? markers[0]!.km : undefined}
          units={units}
          underlay={underlay}
          underlayStatus={evidence.status}
          onUnderlay={() => setUnderlay((value) => !value)}
          interaction={state.interaction}
          onInteraction={(interaction) => dispatch({ type: 'interaction', interaction })}
          onMapStyle={(style) => dispatch({ type: 'mapStyle', style })}
          onLocate={() => void planner.locate()}
          onFitRoute={planner.fitRoute}
        />
        <PlannerSheet
          state={state}
          sheetHeight={sheetHeight}
          scoringWeights={planner.scoringWeights}
          evidenceRanking={planner.evidenceRanking}
          onEvidenceRanking={(enabled) => planner.rerank(enabled, planner.scoringWeights)}
          onScoringWeights={(weights) => planner.rerank(planner.evidenceRanking, weights)}
          onPreferences={(preferences) => {
            dispatch({ type: 'preferences', preferences });
            planner.rerouteWith({ preferences });
          }}
          onTool={(tool) => dispatch({ type: 'tool', tool })}
          onTarget={(distanceKm) => dispatch({ type: 'target', distanceKm })}
          onGenerate={() => void planner.generate()}
          onRegenerate={() => {
            dispatch({ type: 'loopSeed' });
            setTimeout(() => void planner.generate(), 0);
          }}
          onCancel={planner.cancel}
          onSelectAlternative={planner.selectAlternative}
          onReverse={() => planner.setWaypoints([...state.plan.waypoints].reverse())}
          onOutAndBack={planner.outAndBack}
          onWaypoints={planner.editWaypoints}
          onClear={planner.clear}
          onIssue={(issue) => dispatch({ type: 'highlightIssue', id: issue.id })}
          onEdgeDismiss={() => dispatch({ type: 'highlightEdge' })}
          onProfile={placeProfile}
          onSheet={(sheet) => dispatch({ type: 'sheet', sheet })}
          onOverlay={(value) => dispatch({ type: 'overlay', overlay: value })}
          onDismiss={requestBack}
          series={series}
          spans={spans}
          legend={overlay.legend}
          overlayUnavailable={overlay.unavailable}
          onSearchSelect={(coordinate) => {
            dispatch({ type: 'camera', center: coordinate, zoom: 15 });
            planner.startAt(coordinate);
          }}
          onFocusPoint={(coordinate) =>
            dispatch({ type: 'camera', center: coordinate, zoom: Math.max(15, state.camera.zoom) })
          }
          onExport={() => {
            if (!state.selectedRoute) return;
            void exportGpx(state.selectedRoute, state.plan.activity).catch((error) =>
              dispatch({ type: 'routeError', error: (error as Error).message }),
            );
          }}
        />
      </Animated.View>

      <Animated.View
        style={[StyleSheet.absoluteFill, styles.homeLayer, homeStyle]}
        pointerEvents={view === 'home' ? 'auto' : 'none'}
        aria-hidden={view !== 'home'}
        accessibilityElementsHidden={view !== 'home'}
        importantForAccessibility={view === 'home' ? 'auto' : 'no-hide-descendants'}
      >
        <HomeScreen
          activity={activity}
          mode={mode}
          targetKm={targetKm}
          onActivity={setActivity}
          onMode={setMode}
          onTarget={setTargetKm}
          onCreate={createRoute}
          onResume={draft ? resumeDraft : undefined}
          page={page}
          pageIndex={pageIndex}
          pageSize={PAGE_SIZE}
          loading={loadingRoutes}
          error={routesError}
          onPage={setPageIndex}
          onOpen={(id, interaction) => void openRoute(id, interaction)}
          onDelete={(id) => void removeRoute(id)}
          onSettings={() => router.push('/settings')}
        />
      </Animated.View>

      <View style={styles.dialogLayer} pointerEvents={dialog ? 'auto' : 'none'}>
        {dialog === 'save' && (
          <Dialog
            title="Save this route"
            message="Saved routes stay on this device."
            value={nameDraft}
            placeholder="Route name"
            onChange={setNameDraft}
            confirmLabel="Save"
            onConfirm={() => void commitSave()}
            onCancel={() => setDialog(undefined)}
            accent={ACTIVITY[state.plan.activity].color}
            busy={saving}
          />
        )}
        {dialog === 'discard' && (
          <Dialog
            title="Leave without saving?"
            message="This route has changes that are not in your saved routes."
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            onConfirm={discard}
            onCancel={() => setDialog(undefined)}
            accent={ACTIVITY[state.plan.activity].color}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e9eee8' },
  // The web map draws its own zoom control into the map element, which carries a
  // stacking order of its own; both layers are lifted clear of it so the map
  // never shows controls through the page covering it.
  plannerLayer: { zIndex: 3 },
  homeLayer: { zIndex: 4 },
  dialogLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5 },
});
