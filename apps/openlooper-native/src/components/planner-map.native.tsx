import MapView, {
  Geojson,
  Marker,
  Polyline,
  type MapPressEvent,
  type MapType,
  type Region,
} from 'react-native-maps';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { COLOR } from '@/theme';
import { pulledSection } from '@/domain/route-positions';
import { waypointLabel, waypointMarker } from '@/domain/waypoints';
import { roleColor } from './ui/waypoint-role';
import type { Coordinate, MapStyleId } from '@/domain/models';
import type { PlannerMapProps } from './planner-map.types';

/** A reshape in progress: where the line was taken hold of, where the finger has
 * pulled it to, and the stretch of route drawn either side of it. */
type RouteDrag = { from: Coordinate; to: Coordinate; anchors: [Coordinate, Coordinate] };
/** How much of the screen a fingertip covers, for deciding whether a press
 * landed on the route. */
const TOUCH_SLOP_PX = 22;
/** How long a finger rests on the route before it takes hold of it. Shorter and
 * a pan that starts on the line would be caught; longer and it feels stuck. */
const HOLD_MS = 380;
/** How far a finger may stray during that hold before it counts as a pan. */
const HOLD_SLOP_PX = 10;
/** How many points of the route the hit test walks. Every touch event checks
 * the whole list, so a dense route is thinned to something a frame can afford;
 * at this many the gaps stay far below a fingertip at any usable zoom. */
const HIT_SAMPLES = 1200;
/** How often the pulled shape is redrawn while dragging. It is a guide line, not
 * an animation, and each redraw is a React render of the whole map. */
const PREVIEW_MS = 60;
/** Recorded-use sections are one overlay each; past this the map stops being
 * worth drawing. The underlay is a sense of where people go, not a full record. */
const MOST_EVIDENCE_FEATURES = 350;

const nativeCoordinates = (points: Coordinate[]) =>
  points.map((point) => ({ latitude: point.lat, longitude: point.lon }));

// MapKit has no terrain type, so the planner's styles map straight onto the
// four it does support.
const MAP_TYPE: Record<MapStyleId, MapType> = {
  standard: 'standard',
  muted: 'mutedStandard',
  satellite: 'satellite',
  hybrid: 'hybrid',
};

export function PlannerMap({
  activeTool,
  interaction,
  bands,
  showIssues,
  camera,
  mapStyle,
  bottomInset,
  leftInset,
  waypoints,
  mode,
  active,
  route,
  fitRequest,
  alternatives,
  highlightedIssue,
  profilePoint,
  markers,
  evidenceSections,
  onMapPress,
  onWaypointPress,
  onWaypointDelete,
  onWaypointMove,
  onIssuePress,
  onEdgePress,
  onRouteDrag,
  onBoundsChange,
  onAlternativePress,
  onCameraChange,
}: PlannerMapProps) {
  const map = useRef<MapView>(null);
  // The point whose popup is open, and what is needed to place that popup: the
  // region on screen and the size it is drawn at.
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [region, setRegion] = useState<Region | undefined>(undefined);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  // Seeded with the region the map mounts at, so the framing effect below does
  // not re-animate over `initialRegion` before the map has been laid out.
  const emittedCenter = useRef<Coordinate | undefined>(camera.center);
  const size = useRef({ width: 0, height: 0 });
  const inset = useRef({ bottom: bottomInset, left: leftInset });
  inset.current = { bottom: bottomInset, left: leftInset };
  const [drag, setDrag] = useState<RouteDrag | undefined>(undefined);
  // The reshape gesture decides whether it owns a touch, and only a worklet may
  // change a gesture's state, so everything the decision needs is published to
  // the UI thread rather than read from React.
  const shape = useSharedValue<{ geometry: Coordinate[]; points: Coordinate[] }>({
    geometry: [],
    points: [],
  });
  const view = useSharedValue<
    { region: Region; width: number; height: number; editing: boolean } | undefined
  >(undefined);
  const press = useSharedValue<{ at: Coordinate; x: number; y: number; time: number } | undefined>(
    undefined,
  );
  const emitted = useSharedValue(0);
  /** The full geometry, for work that happens back on the JS thread. */
  const geometry = useRef<Coordinate[]>([]);
  geometry.current = route?.geometry ?? [];
  /** The reshape in flight, so ending it does not depend on a render landing. */
  const held = useRef<RouteDrag | undefined>(undefined);
  const imagery = mapStyle === 'satellite' || mapStyle === 'hybrid';
  const editing = interaction === 'edit';
  // The add tool wants raw map taps; inspecting always prefers the feature tap.
  const readable = !editing || activeTool !== 'add';

  useEffect(() => {
    if (!route?.geometry.length) return;
    map.current?.fitToCoordinates(nativeCoordinates(route.geometry), {
      edgePadding: { top: 110, right: 50, bottom: inset.current.bottom + 40, left: inset.current.left + 50 },
      animated: true,
    });
  }, [fitRequest, route?.geometry, route?.id]);

  // Framing is done with an explicit region rather than `animateCamera`, so the
  // on-screen scale is exactly what the offset below is calculated against.
  // MapKit ignores `mapPadding` when centring, so the sheet is accounted for by
  // moving the centre south until the target sits in the strip above it.
  useEffect(() => {
    const emitted = emittedCenter.current;
    if (emitted && Math.abs(emitted.lat - camera.center.lat) < 0.00001 && Math.abs(emitted.lon - camera.center.lon) < 0.00001) return;
    const { width, height } = size.current;
    if (width <= 0 || height <= 0) return;
    const longitudeDelta = 360 / 2 ** camera.zoom;
    const latitudeDelta =
      longitudeDelta * Math.cos((camera.center.lat * Math.PI) / 180) * (height / width);
    const shift = (latitudeDelta * Math.min(inset.current.bottom, height * 0.8)) / (2 * height);
    map.current?.animateToRegion({
      latitude: camera.center.lat - shift,
      longitude: camera.center.lon,
      latitudeDelta,
      longitudeDelta,
    });
  }, [camera.center.lat, camera.center.lon, camera.zoom]);

  useEffect(() => {
    if (!highlightedIssue?.geometry.length) return;
    map.current?.fitToCoordinates(nativeCoordinates(highlightedIssue.geometry), {
      edgePadding: { top: 130, right: 60, bottom: inset.current.bottom + 60, left: inset.current.left + 60 },
      animated: true,
    });
  }, [highlightedIssue]);

  // Hit testing walks the route on every touch, so a dense route is thinned to
  // something a frame can afford. At this spacing the gaps are far below a
  // fingertip at any usable zoom.
  useEffect(() => {
    const geometry = route?.geometry ?? [];
    const step = Math.max(1, Math.ceil(geometry.length / HIT_SAMPLES));
    shape.value = {
      geometry: geometry.filter((_, index) => index % step === 0 || index === geometry.length - 1),
      points: waypoints.map((point) => point.coordinate),
    };
  }, [route?.geometry, shape, waypoints]);

  useEffect(() => {
    view.value =
      region && layout.width > 0
        ? { region, width: layout.width, height: layout.height, editing }
        : undefined;
  }, [editing, layout, region, view]);

  const openPoint = active ? waypoints.find((point) => point.id === selected) : undefined;
  const openIndex = openPoint ? waypoints.indexOf(openPoint) : -1;
  // A loop's start is also its finish, and the last point standing cannot go
  // either, so neither offers to be removed.
  const removable = editing && openPoint?.role !== 'start' && waypoints.length > 2;
  const anchor = openPoint && region && layout.width > 0 ? project(openPoint.coordinate, region, layout) : undefined;

  const beginDrag = useCallback((at: Coordinate) => {
    setSelected(undefined);
    held.current = { from: at, to: at, anchors: pulledSection(geometry.current, at) };
    setDrag(held.current);
  }, []);
  const moveDrag = useCallback((to: Coordinate) => {
    setDrag((current) => (current ? { ...current, to } : current));
  }, []);
  /**
   * Ends the reshape. Where the finger left the line is passed in rather than
   * read back from the drawn state, which the render has not caught up with —
   * and the edit is made outside the state update, so it happens exactly once.
   */
  const endDrag = useCallback(
    (to?: Coordinate) => {
      const current = held.current;
      held.current = undefined;
      setDrag(undefined);
      if (current && to) onRouteDrag(current.from, to);
    },
    [onRouteDrag],
  );

  // Taking hold of the route and pulling it is the one gesture that reshapes a
  // route without first choosing a tool. It activates by hand rather than on its
  // own, so the map keeps everything that is not a deliberate hold on the line:
  // a pan that happens to start on the route is still a pan.
  //
  // The touch callbacks are worklets because a gesture's state can only be set
  // from the UI thread — asking for them on the JS thread makes `activate` and
  // `fail` do nothing at all.
  const reshape = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((event) => {
          'worklet';
          press.value = undefined;
          const touch = event.changedTouches[0];
          const seen = view.value;
          // A second finger is a pinch, which belongs to the map.
          if (event.allTouches.length > 1) return;
          if (!touch || !seen?.editing || !shape.value.geometry.length) return;
          // A press on one of the route's own points belongs to that point: it
          // opens the point and offers to remove it. Only the line between them
          // can be taken hold of.
          if (nearAny(shape.value.points, seen, touch.x, touch.y, TOUCH_SLOP_PX)) return;
          if (!nearAny(shape.value.geometry, seen, touch.x, touch.y, TOUCH_SLOP_PX)) return;
          press.value = {
            at: unprojectOn(touch.x, touch.y, seen),
            x: touch.x,
            y: touch.y,
            time: Date.now(),
          };
        })
        .onTouchesMove((event, manager) => {
          'worklet';
          const held = press.value;
          const touch = event.changedTouches[0];
          if (!held || !touch) return;
          if (Date.now() - held.time >= HOLD_MS) {
            // Rested on the line long enough: take the touch off the map.
            press.value = undefined;
            emitted.value = 0;
            manager.activate();
            runOnJS(beginDrag)(held.at);
            return;
          }
          // Moving before the hold completes is a pan, so the gesture steps
          // aside and lets the map have it.
          if (Math.hypot(touch.x - held.x, touch.y - held.y) > HOLD_SLOP_PX) {
            press.value = undefined;
            manager.fail();
          }
        })
        .onUpdate((event) => {
          'worklet';
          const seen = view.value;
          if (!seen) return;
          // The preview is a React-rendered polyline, so it is fed at a rate a
          // guide line needs rather than at every frame of the drag.
          const now = Date.now();
          if (now - emitted.value < PREVIEW_MS) return;
          emitted.value = now;
          runOnJS(moveDrag)(unprojectOn(event.x, event.y, seen));
        })
        .onEnd((event) => {
          'worklet';
          const seen = view.value;
          if (seen) runOnJS(endDrag)(unprojectOn(event.x, event.y, seen));
        })
        .onFinalize(() => {
          'worklet';
          press.value = undefined;
          // Nothing to reshape to: a gesture that ended already cleared itself,
          // and one that was cancelled leaves the route as it was.
          runOnJS(endDrag)(undefined);
        }),
    [beginDrag, emitted, endDrag, moveDrag, press, shape, view],
  );

  return (
    <View style={styles.root}>
      <GestureDetector gesture={reshape}>
        <MapView
          ref={map}
          style={styles.map}
          mapType={MAP_TYPE[mapStyle]}
          showsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          showsScale={false}
          toolbarEnabled={false}
          userInterfaceStyle={imagery ? 'dark' : 'light'}
          initialRegion={{
            latitude: camera.center.lat,
            longitude: camera.center.lon,
            latitudeDelta: 0.1,
            longitudeDelta: 0.12,
          }}
          onPress={(event: MapPressEvent) => {
            // With a popup open the first tap only closes it, so dismissing one
            // never drops a point as a side effect.
            if (selected) {
              setSelected(undefined);
              return;
            }
            onMapPress({
              lat: event.nativeEvent.coordinate.latitude,
              lon: event.nativeEvent.coordinate.longitude,
            });
          }}
          onRegionChangeComplete={(next: Region) => {
            emittedCenter.current = { lat: next.latitude, lon: next.longitude };
            setRegion(next);
            onCameraChange(
              { lat: next.latitude, lon: next.longitude },
              Math.log2(360 / Math.max(next.longitudeDelta, 0.00001)),
            );
            onBoundsChange([
              next.longitude - next.longitudeDelta / 2,
              next.latitude - next.latitudeDelta / 2,
              next.longitude + next.longitudeDelta / 2,
              next.latitude + next.latitudeDelta / 2,
            ]);
          }}
          // The map is frozen while the route is being pulled, so the shape being
          // dragged stays under the finger dragging it.
          scrollEnabled={!drag}
          // The popup is placed against the region, so it is dropped rather than
          // left behind while the map is being moved under it.
          onPanDrag={() => setSelected(undefined)}
          onLayout={(event: LayoutChangeEvent) => {
            const { width, height } = event.nativeEvent.layout;
            if (width > 0 && height > 0) {
              size.current = { width, height };
              setLayout({ width, height });
            }
          }}
          accessibilityLabel="Route planning map"
        >
          {/* Recorded use goes down first, so it reads as part of the map being
              planned over rather than as something drawn on the route. */}
          {!!evidenceSections?.features.length && (
            <Geojson
              geojson={{
                type: 'FeatureCollection',
                features: evidenceSections.features.slice(0, MOST_EVIDENCE_FEATURES),
              }}
              strokeColor="rgba(104,70,165,0.45)"
              strokeWidth={4}
            />
          )}
          {alternatives
            .filter((item) => item.result.id !== route?.id)
            .map((item) => (
              <Polyline
                key={item.id}
                coordinates={nativeCoordinates(item.result.geometry)}
                strokeColor={imagery ? 'rgba(255,255,255,0.5)' : 'rgba(45,54,48,0.34)'}
                strokeWidth={5}
                tappable
                onPress={(event) => {
                  event.stopPropagation();
                  if (readable) onAlternativePress(item.id);
                }}
              />
            ))}
          {route && (
            <>
              <Polyline
                coordinates={nativeCoordinates(route.geometry)}
                strokeColor="rgba(255,255,255,0.92)"
                strokeWidth={9}
              />
              {bands.map((band, index) => (
                <Polyline
                  key={`band-${index}-${band.beginIndex}`}
                  coordinates={nativeCoordinates(
                    route.geometry.slice(band.beginIndex, band.endIndex + 1),
                  )}
                  strokeColor={band.color}
                  strokeWidth={5}
                />
              ))}
              {route.edges.map((edge, index) => (
                <Polyline
                  key={`edge-${index}`}
                  coordinates={nativeCoordinates(
                    route.geometry.slice(edge.beginIndex, edge.endIndex + 1),
                  )}
                  strokeColor="rgba(0,0,0,0.01)"
                  strokeWidth={18}
                  tappable
                  onPress={(event) => {
                    event.stopPropagation();
                    if (readable) onEdgePress(index);
                  }}
                />
              ))}
              {showIssues && route.issues.map((issue) => (
                <Polyline
                  key={issue.id}
                  coordinates={nativeCoordinates(issue.geometry)}
                  strokeColor={issue.severity === 'high' ? COLOR.danger : COLOR.warning}
                  strokeWidth={7}
                  tappable
                  onPress={(event) => {
                    event.stopPropagation();
                    if (readable) onIssuePress(issue.id);
                  }}
                />
              ))}
            </>
          )}
          {!route && waypoints.length > 1 && (
            <Polyline
              coordinates={nativeCoordinates(waypoints.map((point) => point.coordinate))}
              strokeColor={COLOR.via}
              strokeWidth={4}
              lineDashPattern={[8, 6]}
            />
          )}
          {highlightedIssue && (
            <Polyline
              coordinates={nativeCoordinates(highlightedIssue.geometry)}
              strokeColor={COLOR.highlight}
              strokeWidth={10}
            />
          )}
          {markers.map((mark) => (
            <Marker
              key={`km-${mark.km}`}
              coordinate={{ latitude: mark.coordinate.lat, longitude: mark.coordinate.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              accessibilityLabel={`${mark.km} kilometres`}
            >
              <View style={styles.km}>
                <Text style={styles.kmText}>{mark.km}</Text>
              </View>
            </Marker>
          ))}
          {drag && (
            <Polyline
              coordinates={nativeCoordinates([drag.anchors[0], drag.to, drag.anchors[1]])}
              strokeColor={COLOR.danger}
              strokeWidth={3}
              lineDashPattern={[6, 5]}
            />
          )}
          {waypoints.map((point, index) => (
              <Marker
                key={point.id}
                coordinate={{ latitude: point.coordinate.lat, longitude: point.coordinate.lon }}
                anchor={{ x: 0.5, y: 0.5 }}
                // No `title`: MapKit presents a callout of its own for any marker
                // that has one, which showed a second copy of the name under the
                // popup the planner draws itself.
                draggable={editing}
                onDragEnd={(event) =>
                  onWaypointMove(point.id, {
                    lat: event.nativeEvent.coordinate.latitude,
                    lon: event.nativeEvent.coordinate.longitude,
                  })
                }
                onPress={(event) => {
                  event.stopPropagation();
                  onWaypointPress(point.id);
                  setSelected((current) => (current === point.id ? undefined : point.id));
                }}
              >
                <View style={[styles.pin, { backgroundColor: roleColor(point.role) }]}>
                  <Text style={styles.pinText}>{waypointMarker(point.role, index)}</Text>
                </View>
              </Marker>
          ))}
          {profilePoint && (
            <Marker
              coordinate={{ latitude: profilePoint.lat, longitude: profilePoint.lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              title="Elevation profile position"
            >
              <View style={styles.profilePin} />
            </Marker>
          )}
        </MapView>
      </GestureDetector>
      {/* The point's popup, drawn over the map rather than as a MapKit callout.
          A callout is presented outside its marker's bounds, and the tap handler
          that would reach anything inside it hangs off the marker, so a button in
          there never receives the touch. Placing it here keeps the layout and the
          touch targets ours. */}
      {!!openPoint && !!anchor && (
        <View pointerEvents="box-none" style={styles.overlay}>
          <View
            style={[
              styles.popup,
              {
                left: Math.max(8, Math.min(layout.width - POPUP_WIDTH - 8, anchor.x - POPUP_WIDTH / 2)),
                top: anchor.y - POPUP_HEIGHT - 26,
              },
            ]}
          >
            <Text style={styles.popupText} numberOfLines={1}>
              {waypointLabel(mode, openPoint.role, openIndex)}
            </Text>
            {removable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${waypointLabel(mode, openPoint.role, openIndex)}`}
                hitSlop={8}
                onPress={() => {
                  setSelected(undefined);
                  onWaypointDelete(openPoint.id);
                }}
                style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
              >
                <Text style={styles.removeText}>✕</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * Where a coordinate lands on screen. Over a single screen's span the flat
 * mapping is accurate to well under a pixel, which is all a popup anchor needs.
 */
function project(point: Coordinate, region: Region, layout: { width: number; height: number }) {
  return {
    x: layout.width * (0.5 + (point.lon - region.longitude) / region.longitudeDelta),
    y: layout.height * (0.5 - (point.lat - region.latitude) / region.latitudeDelta),
  };
}

type Viewport = { region: Region; width: number; height: number; editing: boolean };

/**
 * Screen position back to a coordinate: the inverse of `project`, and accurate
 * over one screen's span for the same reason. A worklet, because the reshape
 * gesture works this out on the UI thread.
 */
function unprojectOn(x: number, y: number, view: Viewport): Coordinate {
  'worklet';
  return {
    lat: view.region.latitude + (0.5 - y / view.height) * view.region.latitudeDelta,
    lon: view.region.longitude + (x / view.width - 0.5) * view.region.longitudeDelta,
  };
}

/**
 * Whether a touch landed on any of these coordinates, judged in pixels. Screen
 * distance is the right measure: what counts as "on it" is how much of the map
 * a fingertip covers, whatever the scale underneath.
 */
function nearAny(
  points: Coordinate[],
  view: Viewport,
  x: number,
  y: number,
  slop: number,
): boolean {
  'worklet';
  for (let index = 0; index < points.length; index++) {
    const point = points[index]!;
    const px = view.width * (0.5 + (point.lon - view.region.longitude) / view.region.longitudeDelta);
    if (Math.abs(px - x) > slop) continue;
    const py = view.height * (0.5 - (point.lat - view.region.latitude) / view.region.latitudeDelta);
    if (Math.abs(py - y) <= slop) return true;
  }
  return false;
}

const POPUP_WIDTH = 190;
const POPUP_HEIGHT = 44;

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  map: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  popup: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    gap: 10,
    paddingLeft: 13,
    paddingRight: 6,
    borderRadius: 14,
    backgroundColor: COLOR.surface,
    shadowColor: '#0b120d',
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  popupText: { flex: 1, color: COLOR.ink, fontSize: 13, fontWeight: '800' },
  remove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: COLOR.danger,
  },
  removePressed: { opacity: 0.7 },
  removeText: { color: '#fff', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  pin: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: '#fff',
    shadowColor: '#0b120d',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  km: {
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
  kmText: { color: '#2d3630', fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  profilePin: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#111',
  },
});
